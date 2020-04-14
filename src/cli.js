import * as http from 'http'
import * as path from 'path'

import open from 'open'
import express from 'express'
import proxy from 'express-http-proxy'
import morgan from 'morgan'

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
		open: false,
	},
	(function () {
		try {
			return require(path.join(process.cwd(), 'cybuddy.config.js'))
		} catch (error) {
			if (!String(error).includes('Cannot find module')) {
				throw error
			}
		}
	})() || {},
)
if (!config.targetUrl) {
	throw new Error(`No targetUrl is specified in cybuddy.config.js`)
}

const app = express()
const apiRouter = express()

apiRouter.use(morgan('dev'))
apiRouter.get('/init', async (_, res) => {
	try {
		if (!(await config.verifyTestMode())) {
			res.status(403)
			res.end(`Not running in test mode.`)
			return
		}

		res.json({
			targetUrl: config.targetUrl,
		})
	} catch (error) {
		res.status(500)
		res.end(String(error))
	}
})

app.use('/api', apiRouter)
app.use('/cybuddy', express.static(path.resolve(__dirname, 'web', 'dist')))
app.use('/cybuddy', (req, res) => {
	if (req.path === '/cybuddy' || req.path === '/cybuddy/') {
		res.sendFile(path.resolve(__dirname, 'web', 'dist', 'index.html'))
	}
})
app.use(proxy(config.targetUrl))

const server = http.createServer(app)
server.listen(config.port, () => {
	console.log(` * Started at :${config.port}`)

	if (config.open) {
		open(`http://localhost:${config.port}`)
	}
})
