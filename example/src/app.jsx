import React, { useState, Suspense, lazy } from 'react'
import { render } from 'react-dom'

const CyBuddy = lazy(() => import('@karimsa/cybuddy'))

import('jquery').then(($) => {
	window.$ = $
})

function App() {
	if (
		process.env.NODE_ENV !== 'production' &&
		new URLSearchParams(location.search).get('testMode') === 'true'
	) {
		return (
			<Suspense fallback={<p>Loading ...</p>}>
				<CyBuddy
					baseURL="http://localhost:1234"
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
	const [counter, setCounter] = useState(0)
	return (
		<React.Fragment>
			<h1>Hello world</h1>
			<p>This is a paragraph</p>
			<p>Counter: {counter}</p>
			<button
				data-test="btn-decrease"
				type="button"
				onClick={() => setCounter(counter - 1)}
			>
				-
			</button>
			<button
				data-test="btn-increase"
				type="button"
				onClick={() => setCounter(counter + 1)}
			>
				+
			</button>
		</React.Fragment>
	)
}

render(<App />, document.getElementById('app'))
