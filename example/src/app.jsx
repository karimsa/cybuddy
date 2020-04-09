import React, { useState } from 'react'
import { render } from 'react-dom'
import { CyBuddy } from '@karimsa/cybuddy'

function App() {
	if (
		process.env.NODE_ENV !== 'production' &&
		new URLSearchParams(location.search).get('testMode') === 'true'
	) {
		// Don't do this in production - you should code split and
		// lazy load this
		return (
			<CyBuddy
				baseURL="http://localhost:1234"
				verifyTestMode={() => Promise.resolve(process.env.NODE_ENV === 'test')}
				initialSteps={[]}
			/>
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
				data-test="btn-increase"
				type="button"
				onClick={() => setCounter(counter - 1)}
			>
				-
			</button>
			<button
				data-test="btn-decrease"
				type="button"
				onClick={() => setCounter(counter + 1)}
			>
				+
			</button>
		</React.Fragment>
	)
}

render(<App />, document.getElementById('app'))
