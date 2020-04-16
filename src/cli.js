import * as http from 'http'
import * as path from 'path'
import { promises as fs } from 'fs'

import open from 'open'
import express from 'express'
import proxy from 'express-http-proxy'
import frameguard from 'frameguard'

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
				error: String(error),
			})
		}
	}
}

async function main() {
	const kConfigMissing = Symbol('kConfigMissing')
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
			open: true,
		},
		(function () {
			try {
				return require(path.join(process.cwd(), 'cybuddy.config.js'))
			} catch (error) {
				if (!String(error).includes('Cannot find module')) {
					throw error
				}
				return {
					[kConfigMissing]: true,
				}
			}
		})(),
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
			}
		}),
	)
	apiRouter.get(
		'/templates',
		route(async () => {
			return fs.readdir('./cypress/templates')
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
	app.use(frameguard({ action: 'SAMEORIGIN' }))
	app.use(proxy(config.targetUrl))

	const server = http.createServer(app)
	server.listen(config.port, () => {
		console.log(
			`🚀 Server started at: http://localhost:${config.port}/cybuddy/`,
		)

		if (config.open) {
			open(`http://localhost:${config.port}/cybuddy/`)
		}
	})
}

main().catch((error) => {
	console.error(error.stack || error)
	process.exit(1)
})
