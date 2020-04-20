import * as http from 'http'
import * as path from 'path'
import { promises as fs } from 'fs'

import express from 'express'
import bodyParser from 'body-parser'
import proxy from 'express-http-proxy'
import puppeteer from 'puppeteer'

function checkUrl(url) {
	return new Promise((resolve, reject) => {
		http
			.get(url, (res) => {
				resolve()
				res.destroy()
			})
			.on('error', reject)
	})
}

class APIError extends Error {
	constructor(message, status = 500) {
		super(message)
		this.status = status
	}
}

function route(fn) {
	return async (req, res) => {
		try {
			const body = await fn(req, res)
			if (typeof body === 'string') {
				res.end(body)
			} else {
				res.json(body)
			}
		} catch (error) {
			res.status(error.status || 500)
			res.json({
				error: String(error.stack || error),
			})
		}
	}
}

function noop() {
	// NO-OP
}

const kConfigMissing = Symbol('kConfigMissing')

function openConfigFile() {
	try {
		return require(path.join(process.cwd(), 'cybuddy.config.js'))
	} catch (error) {
		if (!String(error).match(/Cannot find module.*cybuddy\.config\.js/)) {
			throw error
		}
		return {
			[kConfigMissing]: true,
		}
	}
}

async function main() {
	const config = Object.assign(
		{
			async verifyTestMode() {
				return true
			},
			isXHRAllowed() {
				return true
			},
			targetUrl: null,
			actions: [],
			port: 2468,
		},
		openConfigFile(),
	)
	if (config[kConfigMissing]) {
		const prompts = require('prompts')
		const { targetUrl } = await prompts({
			type: 'text',
			name: 'targetUrl',
			message: 'No cybuddy config was found. What URL would you like to test?',
			validate: (url) => {
				try {
					const _ = new URL(url)
					return true
				} catch (_) {
					return false
				}
			},
		})
		config.targetUrl = targetUrl

		await fs.writeFile(
			path.join(process.cwd(), 'cybuddy.config.js'),
			[`module.exports = {`, `\ttargetUrl: '${targetUrl}',`, `}`].join('\n'),
			{ flag: 'wx' },
		)
	}
	if (!config.targetUrl) {
		throw new Error(`No targetUrl is specified in cybuddy.config.js`)
	}

	try {
		const cypressJSON = JSON.parse(await fs.readFile('./cypress.json', 'utf8'))
		cypressJSON.chromeWebSecurity = false
		await fs.writeFile(
			'./cypress.json',
			JSON.stringify(cypressJSON, null, '\t'),
		)
	} catch (_) {
		await fs.writeFile(
			'./cypress.json',
			JSON.stringify(
				{
					chromeWebSecurity: false,
				},
				null,
				'\t',
			),
		)
	}

	try {
		await fs.mkdir('./cypress/templates')
	} catch (error) {
		if (error.code !== 'EEXIST') {
			throw error
		}
	}

	try {
		await checkUrl(config.targetUrl)
	} catch (_) {
		console.error(`Could not find server at: ${config.targetUrl}`)
		console.error(`Are you sure it is running?`)
		process.exit(1)
	}

	const app = express()
	const apiRouter = express()

	apiRouter.use(bodyParser.json())
	apiRouter.get('/status', (_, res) => {
		res.end(`I'm alive.`)
	})
	apiRouter.get(
		'/init',
		route(async () => {
			if (!(await config.verifyTestMode())) {
				throw new APIError(`Not running in test mode`, 403)
			}

			return {
				targetUrl: config.targetUrl,
				actions: config.actions,
			}
		}),
	)

	apiRouter.get(
		'/test-files',
		route(async () => {
			const files = await fs.readdir('./cypress/integration')
			return files.filter((filename) => {
				return filename.endsWith('.spec.js')
			})
		}),
	)
	apiRouter.get(
		'/test-files/:filename',
		route(async (req) => {
			const testCode = await fs.readFile(
				path.resolve(
					process.cwd(),
					'cypress',
					'integration',
					req.params.filename,
				),
				'utf8',
			)
			const childModule = { exports: {} }
			const { Function: Func } = global
			const fn = new Func('describe', 'require', 'module', testCode)
			fn(noop, noop, childModule)
			return childModule.exports
		}),
	)
	apiRouter.post(
		'/test-files/:filename',
		route(async (req) => {
			const { code, force } = req.body
			await fs.writeFile(
				path.resolve(
					process.cwd(),
					'cypress',
					'integration',
					req.params.filename,
				),
				code,
				{
					flag: force ? 'w' : 'wx',
				},
			)
			return { ok: true }
		}),
	)

	apiRouter.get(
		'/templates',
		route(async () => {
			return fs.readdir('./cypress/templates')
		}),
	)
	apiRouter.post(
		'/templates/:filename',
		route(async (req) => {
			let filename = req.params.filename
			filename =
				filename.substr(0, filename.length - '.spec.js'.length) + '.json'

			try {
				await fs.writeFile(
					`./cypress/templates/${filename}`,
					JSON.stringify(
						{
							steps: req.body.steps,
						},
						null,
						'\t',
					),
					{
						flag: req.body.force ? 'w' : 'wx',
					},
				)
			} catch (error) {
				if (error.code === 'EEXIST') {
					throw new Error(`Template named '${filename}' already exists`)
				}
				throw error
			}

			return {
				name: filename,
			}
		}),
	)
	apiRouter.get(
		'/template/:templateName',
		route(async (req, res) => {
			res.set('Content-Type', 'application/json')
			return fs.readFile(
				`./cypress/templates/${req.params.templateName}`,
				'utf8',
			)
		}),
	)
	apiRouter.post(
		'/actions/:action/generate',
		route(async (req) => {
			const action = (config.actions || []).find(
				(action) => action.action === req.params.action,
			)
			if (!action) {
				throw new APIError(
					`Could not find action with name '${req.params.action}'`,
					404,
				)
			}
			if (!action.generateStep) {
				throw new APIError(
					`Action '${action.action}' does not implement .generateStep()`,
				)
			}

			const testStep = req.body
			const code = await action.generateStep(testStep)
			if (typeof code !== 'string') {
				throw new Error(
					`Action '${action.action}' returned a non-string result for .generateStep()`,
				)
			}
			return {
				code: [testStep.comment && `// ${testStep.comment}`, code]
					.filter(Boolean)
					.join('\n'),
			}
		}),
	)

	function createCyProxy(runSteps) {
		return new Proxy(
			{},
			{
				get(_, method) {
					return (...args) => {
						const chain = []
						runSteps.push({
							method,
							args,
							chain,
						})
						return createCyProxy(chain)
					}
				},
			},
		)
	}

	apiRouter.post(
		'/actions/:action/run',
		route(async (req) => {
			const action = (config.actions || []).find(
				(action) => action.action === req.params.action,
			)
			if (!action) {
				throw new APIError(
					`Could not find action with name '${req.params.action}'`,
					404,
				)
			}
			if (!action.runStep) {
				throw new APIError(
					`Action '${action.action}' does not implement .runStep()`,
				)
			}

			const testStep = req.body
			const runSteps = []
			const cyProxy = createCyProxy(runSteps)

			await action.runStep(testStep, cyProxy)
			return runSteps
		}),
	)
	apiRouter.use(
		route((req) => {
			throw new APIError(`API route does not exist: ${req.path}`, 404)
		}),
	)

	app.use('/api', apiRouter)
	app.use('/cybuddy', express.static(path.resolve(__dirname, 'web', 'dist')))
	app.use('/cybuddy', (req, res) => {
		if (req.path === '/cybuddy' || req.path === '/cybuddy/') {
			res.sendFile(path.resolve(__dirname, 'web', 'dist', 'index.html'))
		}
	})
	app.use((_, res, next) => {
		res.set('X-Frame-Options', 'SAMEORIGIN')
		next()
	})
	app.use(proxy(config.targetUrl))

	const server = http.createServer(app)
	await new Promise((resolve, reject) => {
		server.on('error', reject)
		server.listen(config.port, () => {
			console.log(
				`🚀 Server started at: http://localhost:${config.port}/cybuddy/`,
			)
			resolve()
		})
	})

	console.log(`🌍 Opening browser ...`)
	const browser = await puppeteer.launch({
		args: ['--disable-web-security'],
		headless: false,
		defaultViewport: null,
	})
	const [page] = await browser.pages()
	await page.goto(`http://localhost:${config.port}/cybuddy/`)
}

main().catch((error) => {
	console.error(error.stack || error)
	process.exit(1)
})
