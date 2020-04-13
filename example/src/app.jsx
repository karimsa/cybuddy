import React, { useState, Suspense, lazy } from 'react'
import { render } from 'react-dom'

const CyBuddy = lazy(() => import('@karimsa/cybuddy'))
const params = new URLSearchParams(location.search)

import('jquery').then(($) => {
	window.$ = $
})

function App() {
	if (
		process.env.NODE_ENV !== 'production' &&
		params.get('testMode') === 'true'
	) {
		return (
			<Suspense fallback={<p>Loading ...</p>}>
				<CyBuddy
					baseURL="http://localhost:1234"
					defaultPathname={`/?async=${params.get('async') === 'true'}`}
					verifyTestMode={() =>
						Promise.resolve(process.env.NODE_ENV === 'test')
					}
					initialSteps={[
						{
							action: 'reset',
						},
					]}
					actions={[
						{
							action: 'console',
							label: 'write to the console',
							params: [
								{
									key: 'message',
									type: 'text',
									defaultValue: 'hello, world',
								},
							],
							generateCode: (step) => `console.warn('${step.args.message}')`,
							runStep: (step) => console.warn(step.args.message),
						},
					]}
				/>
			</Suspense>
		)
	}

	return <Home />
}

function Home() {
	const [counter, _setCounter] = useState(0)
	function setCounter(v) {
		if (params.get('async') === 'true') {
			setTimeout(() => _setCounter(v), 500)
		} else {
			_setCounter(v)
		}
	}
	return (
		<React.Fragment>
			<h1>Hello world</h1>
			<p>This is a paragraph</p>
			<p data-test="counter-output">Counter: {counter}</p>
			<button
				data-test="btn-decrease"
				type="button"
				onClick={() => setCounter((c) => c - 1)}
			>
				-
			</button>
			<button
				data-test="btn-increase"
				type="button"
				onClick={() => setCounter((c) => c + 1)}
			>
				+
			</button>
		</React.Fragment>
	)
}

render(<App />, document.getElementById('app'))
