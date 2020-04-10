/** @jsx jsx */

import 'bootstrap/dist/css/bootstrap.min.css'
import 'babel-polyfill'
import $ from 'jquery'
import React, { useEffect, createRef } from 'react'
import { css, jsx } from '@emotion/core'
import { v4 as uuid } from 'uuid'
import Cookies from 'js-cookie'
import PropTypes from 'prop-types'

import { RadioSwitch } from './radio-switch'
import { Alert } from './alert'
import { Spinner } from './spinner'
import { useLocalState, useAsync, useReducer, useAsyncAction } from './hooks'

const iframeXHREvents = []

function generateCode(testStep) {
	switch (testStep.action) {
		case 'reset':
			return ``

		case 'type':
			return `cy.get('${testStep.selector}').clear().type('${testStep.args.typeContent}')`

		case 'click':
			if (testStep.selectType === 'content') {
				return `cy.contains('${testStep.selector}').click()`
			}
			return `cy.get('${testStep.selector}').click()`

		case 'location':
			if (testStep.args.locationMatchType === 'startsWith') {
				return `cy.location('${testStep.args.locationProperty}').should('match', new RegExp('^${testStep.selector}'))`
			}
			return `cy.location('${testStep.args.locationProperty}').should('eq', '${testStep.selector}')`

		case 'exist':
			if (testStep.selectType === 'content') {
				return `cy.contains('${testStep.selector}')`
			}
			return `cy.get('${testStep.selector}')`

		case 'notExist':
			if (testStep.selectType === 'content') {
				return `cy.contains('${testStep.selector}').should('not.exist')`
			}
			return `cy.get('${testStep.selector}').should('not.exist')`

		case 'goto':
			return `cy.visit('${testStep.selector}')`

		case 'select':
			return `cy.get('${testStep.selector}').select('${testStep.args.typeContent}')`

		case 'reload':
			return `cy.reload()`

		case 'xhr':
			return [
				`helpers.waitForXHR({`,
				`\tid: '${testStep.id}',`,
				`\tmethod: '${testStep.args.xhrMethod}',`,
				`\tproperty: '${testStep.args.xhrProperty}',`,
				`\tvalue: '${testStep.selector}',`,
				`})`,
			].join('\n')

		case 'disabled':
			if (testStep.selectType === 'content') {
				return `cy.contains('${testStep.selector}').should('be.disabled')`
			}
			return `cy.get('${testStep.selector}').should('be.disabled')`

		case 'notDisabled':
			if (testStep.selectType === 'content') {
				return `cy.contains('${testStep.selector}').should('not.be.disabled')`
			}
			return `cy.get('${testStep.selector}').should('not.be.disabled')`

		default:
			throw new Error(`Unrecognized action: ${testStep.action}`)
	}
}

// Sourced from the interwebs
function setInputValue(input, value) {
	let lastValue = input.value
	input.value = value

	let event = new Event(input.tagName === 'INPUT' ? 'input' : 'change', {
		bubbles: true,
	})
	event.simulated = true

	let tracker = input._valueTracker
	if (tracker) {
		tracker.setValue(lastValue)
	}

	input.dispatchEvent(event)
}

function createSelector(testStep) {
	if (testStep.selectType === 'content') {
		return [
			'input',
			'button',
			'.alert',
			'a',
			'p',
			'h1',
			'h2',
			'h3',
			'h4',
			'h5',
			'h6',
		]
			.map((tag) => `${tag}:contains(${testStep.selector})`)
			.join(', ')
	}
	return testStep.selector
}

async function execStepUnbound({ onEnvReset, baseURL }, testStep, iframe) {
	switch (testStep.action) {
		case 'reset':
			{
				// Clear storage
				const keys = []
				for (let i = 0; i < iframe.contentWindow.localStorage.length; i++) {
					if (!iframe.contentWindow.localStorage.key(i).startsWith('test:')) {
						keys.push(iframe.contentWindow.localStorage.key(i))
					}
				}
				for (const key of keys) {
					iframe.contentWindow.localStorage.removeItem(key)
				}

				// Clear cookies
				for (const key in Cookies.get()) {
					Cookies.remove(key)
				}

				await onEnvReset()

				iframe.contentWindow.location.href = '/'
			}
			return

		case 'select':
		case 'type':
			setInputValue(
				$(iframe).contents().find(createSelector(testStep)).get(0),
				testStep.args.typeContent,
			)
			return

		case 'click':
			{
				const elm = $(iframe).contents().find(createSelector(testStep)).get(0)
				if (elm) {
					elm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
				}
			}
			return

		case 'location': {
			const currentValue =
				iframe.contentWindow.location[testStep.args.locationProperty]
			if (testStep.args.locationMatchType === 'startsWith') {
				if (currentValue.match(new RegExp(`^${testStep.selector}`))) {
					return
				}
			} else if (currentValue === testStep.selector) {
				return
			}
			throw new Error(
				`Unexpected ${testStep.args.locationProperty}: '${currentValue}' (expected '${testStep.selector}')`,
			)
		}

		case 'exist':
			if ($(iframe).contents().find(createSelector(testStep)).length === 0) {
				throw new Error(
					`Could not find element matching: '${testStep.selector}'`,
				)
			}
			return

		case 'notExist':
			if ($(iframe).contents().find(createSelector(testStep)).length > 0) {
				throw new Error(
					`Found element matching: '${testStep.selector}' (should not exist)`,
				)
			}
			return

		case 'goto':
			iframe.src = `${baseURL}${testStep.selector}`
			return

		case 'reload':
			iframe.contentWindow.location.reload()
			return

		case 'xhr':
			for (
				let xhr = iframeXHREvents.shift();
				xhr;
				xhr = iframeXHREvents.shift()
			) {
				console.warn({ xhr, testStep })
				if (xhr.method === testStep.args.xhrMethod) {
					if (
						testStep.args.xhrProperty === 'pathname' &&
						xhr.pathname === testStep.selector
					) {
						return
					} else if (
						testStep.args.xhrProperty === 'href' &&
						xhr.href === testStep.selector
					) {
						return
					}
				}
			}
			throw new Error(
				`Could not find an XHR request matching: ${testStep.args.xhrMethod} ${testStep.selector}`,
			)

		case 'disabled':
			if (
				!$(iframe).contents().find(createSelector(testStep)).is(':disabled')
			) {
				throw new Error(`'${testStep.selector}' is not disabled (should be)`)
			}
			return

		case 'notDisabled':
			if ($(iframe).contents().find(createSelector(testStep)).is(':disabled')) {
				throw new Error(`'${testStep.selector}' is disabled (should not be)`)
			}
			return

		default:
			throw new Error(`Unrecognized action: ${testStep.action}`)
	}
}

function shorten(text, maxlen) {
	if (text.length > maxlen) {
		return text.substr(0, maxlen) + '...'
	}
	return text
}

function noop() {
	// NO-OP
}

function TestHelperChild({
	initialSteps,
	execStep,
	baseURL,
	defaultPathname,
	isXHRAllowed,
}) {
	const iframeRef = createRef()
	const openFileRef = createRef()
	const [defaultSrc] = useLocalState(
		'test:iframeSrc',
		new URL(defaultPathname, baseURL).href,
	)
	const [testFile, setTestFile] = useLocalState('test:file')
	const [mode, setMode] = useLocalState('test:mode', 'pointer')
	const [activeElm, setActiveElm] = useLocalState('test:activeElm')
	const [testStep, setTestStep] = useLocalState('test:step')
	const [openFileState, { fetch: openFile }] = useAsyncAction((file) => {
		return new Promise((resolve, reject) => {
			const fileReader = new FileReader()
			fileReader.addEventListener('loadend', () => {
				if (fileReader.error) {
					reject(fileReader.error)
				} else {
					const childModule = { exports: {} }
					// eslint-disable-next-line
					const fn = new Function('describe', 'require', 'module', fileReader.result)
					fn(noop, noop, childModule)
					childModule.exports.steps.forEach((step) => {
						// All step IDs are re-generated, in case the file was
						// modified after it was exported
						step.id = uuid()
					})
					resolve(childModule.exports)
				}
			})
			fileReader.readAsText(file, 'UTF-8')
		})
	})

	const [runningState, dispatch] = useReducer({
		start() {
			return {
				running: true,
				timer: setTimeout(() => dispatch({ type: 'checkStep' }), 50),
				stepNumber: 0,
				stepTime: Date.now(),
			}
		},

		stop(state) {
			if (state?.timer) {
				clearTimeout(state.timer)
			}
			return null
		},

		setError(state, { error }) {
			if (state?.timer) {
				clearTimeout(state.timer)
			}
			return {
				...state,
				running: false,
				error,
			}
		},

		async checkStep(state) {
			if (state?.stepNumber == null) {
				throw new Error(`Unexpected state object during 'checkStep'`)
			}

			try {
				await execStep(testFile.steps[state.stepNumber], $('iframe').get(0))
				if (testFile.checksErrorsAfterEveryStep && state.stepNumber > 0) {
					await execStep(
						{
							selectType: 'selector',
							selector: '.alert-danger',
							action: 'notExist',
						},
						$('iframe').get(0),
					)
				}
			} catch (error) {
				if (Date.now() - state.stepTime >= 5e3) {
					return {
						...state,
						running: false,
						failingStep: state.stepNumber,
						error,
					}
				}

				return {
					...state,
					running: true,
					timer: setTimeout(() => dispatch({ type: 'checkStep' }), 50),
				}
			}

			if (state.stepNumber === testFile.steps.length - 1) {
				return null
			}

			return {
				...state,
				running: true,
				timer: setTimeout(() => dispatch({ type: 'checkStep' }), 0),
				stepNumber: state.stepNumber + 1,
				stepTime: Date.now(),
			}
		},
	})

	const runStep = async (step) => {
		try {
			await execStep(step, iframeRef.current)
			dispatch({ type: 'stop' })
		} catch (error) {
			dispatch({ type: 'setError', error })
		}
	}

	useEffect(() => {
		function injectXHR(evt) {
			const iframe = evt.target

			// Watch for location changes
			const iframeWindow = iframe.contentWindow
			const pushState = iframeWindow.history.pushState
			iframeWindow.history.pushState = function () {
				localStorage.setItem(
					'test:iframeSrc',
					JSON.stringify(String(iframeWindow.location.href)),
				)
				return pushState.apply(this, arguments)
			}

			console.warn(`Injecting XHR hooks in iframe`)
			const XMLHttpRequest = iframe.contentWindow.XMLHttpRequest
			const xhrOpen = XMLHttpRequest.prototype.open
			XMLHttpRequest.prototype.open = function (method, url, async) {
				const parsedUrl = new URL(url)
				const xhr = {
					method,
					href: parsedUrl.pathname + parsedUrl.search,
					pathname: parsedUrl.pathname,
				}

				if (isXHRAllowed(xhr)) {
					iframeXHREvents.push(xhr)
				}
				return xhrOpen.call(this, method, url, async)
			}
		}

		if (iframeRef.current) {
			injectXHR({ target: iframeRef.current })
			iframeRef.current.addEventListener('load', injectXHR)
			return () => {
				iframeRef.current.removeEventListener('load', injectXHR)
			}
		}
	}, [iframeRef.current])
	useEffect(() => {
		if (openFileState.result) {
			setTestFile(openFileState.result)
		}
	}, [openFileState.result])
	useEffect(() => {
		if (testFile?.steps?.length > 0 && !runningState?.running) {
			runStep(testFile.steps[testFile.steps.length - 1], iframeRef.current)
		}
	}, [testFile?.steps?.length])
	useEffect(() => {
		if (testStep?.selector && testStep?.action !== 'location') {
			const selector = createSelector(testStep)

			try {
				$(selector)
			} catch {
				return
			}

			const activeBorderWidth = 10
			let elm = $(iframeRef.current).contents().find(selector)
			if (testStep.selectType === 'content') {
				elm = $(elm.get(elm.length - 1))
			}

			if (elm.length === 0) {
				return
			}

			setActiveElm({
				startX: elm.offset().left - activeBorderWidth,
				startY: elm.offset().top - activeBorderWidth,
				endX: elm.offset().left + elm.outerWidth() + activeBorderWidth,
				endY: elm.offset().top + elm.outerHeight() + activeBorderWidth,
			})
		}
	}, [testStep?.selectType, testStep?.selector])

	return (
		<div
			className="container-fluid px-0 overflow-hidden"
			css={css`
				height: 100vh;
			`}
		>
			<div className="row no-gutters h-100">
				<div
					className="col-4 col-xl-3 p-4 bg-light h-100"
					css={css`
						overflow-x: hidden;
						overflow-y: auto;
					`}
				>
					{!testFile && (
						<div className="d-flex align-items-center justify-content-center flex-column h-100">
							<h1 className="text-center mb-4">CyBuddy</h1>

							{openFile.error && (
								<Alert type="danger">{String(openFile.error)}</Alert>
							)}
							{openFile.status === 'inprogress' && <Spinner />}

							<input
								type="file"
								ref={openFileRef}
								className="d-none"
								onChange={(evt) => {
									openFile(evt.target.files[0])
								}}
							/>

							<button
								type="button"
								className="btn btn-block btn-primary"
								onClick={() => openFileRef.current.click()}
								disabled={openFile.status === 'inprogress'}
							>
								Open test
							</button>

							<button
								type="button"
								className="btn btn-block btn-success"
								onClick={() => {
									runStep({
										action: 'reset',
									})
									setTestFile({
										name: 'untitled.spec.js',
										description: 'should work',
										checksErrorsAfterEveryStep: true,
										steps: JSON.parse(JSON.stringify(initialSteps)),
									})
								}}
								disabled={openFile.status === 'inprogress'}
							>
								Create new test from login
							</button>

							<button
								type="button"
								className="btn btn-block btn-warning"
								onClick={() => {
									runStep({
										action: 'reset',
									})
									setTestFile({
										name: 'untitled.spec.js',
										description: 'should work',
										checksErrorsAfterEveryStep: true,
										steps: [],
									})
								}}
								disabled={openFile.status === 'inprogress'}
							>
								Create new empty test
							</button>
						</div>
					)}

					{testFile && (
						<React.Fragment>
							<h1 className="text-center mb-4">CyBuddy</h1>

							<RadioSwitch
								value={mode === 'navigation'}
								onChange={(nav) => setMode(nav ? 'navigation' : 'pointer')}
							>
								Allow navigation
							</RadioSwitch>
							<div className="mt-3">
								<RadioSwitch
									value={Boolean(testFile.checksErrorsAfterEveryStep)}
									onChange={(checksErrorsAfterEveryStep) =>
										setTestFile({
											...testFile,
											checksErrorsAfterEveryStep,
										})
									}
								>
									Checks errors after every step
								</RadioSwitch>
							</div>

							{!testStep && (
								<div className="mt-4 mb-5">
									<input
										type="text"
										className="mb-2 form-control"
										value={testFile.name}
										onChange={(evt) =>
											setTestFile({
												...testFile,
												name: evt.target.value,
											})
										}
									/>
									<input
										type="text"
										className="mb-5 form-control"
										value={testFile.description}
										onChange={(evt) =>
											setTestFile({
												...testFile,
												description: evt.target.value,
											})
										}
									/>

									{runningState?.error && (
										<div className="mb-4">
											<Alert type="danger">{String(runningState.error)}</Alert>
										</div>
									)}

									<p className="text-muted text-uppercase">Steps</p>
									{testFile.steps.map((step, index) => (
										<div
											className={`card mb-4 ${
												index === runningState?.stepNumber ? 'bg-dark' : ''
											} ${
												index === runningState?.failingStep ? 'bg-danger' : ''
											}`}
											key={step.id}
										>
											<div className="card-body p-3">
												<span className="badge badge-primary text-uppercase mr-2">
													{step.action}
												</span>
												{step.action !== 'reload' &&
													step.action !== 'reset' && (
														<span
															className={
																index === runningState?.stepNumber ||
																index === runningState?.failingStep
																	? 'text-white'
																	: ''
															}
														>
															{shorten(
																step.action === 'type'
																	? step.args.typeContent
																	: step.selector,
																16,
															)}
														</span>
													)}
												<div className="mt-2 text-center">
													<button
														type="button"
														className="btn btn-sm btn-info mr-2"
														onClick={() => {
															setTestFile({
																...testFile,
																steps: testFile.steps.map((tStep, tIndex) => {
																	if (tIndex === index) {
																		return testFile.steps[index - 1]
																	}
																	if (tIndex === index - 1) {
																		return step
																	}
																	return tStep
																}),
															})
														}}
													>
														👆
													</button>
													<button
														type="button"
														className="btn btn-sm btn-info mr-2"
														onClick={() => {
															setTestFile({
																...testFile,
																steps: testFile.steps.map((tStep, tIndex) => {
																	if (tIndex === index) {
																		return testFile.steps[index + 1]
																	}
																	if (tIndex === index + 1) {
																		return step
																	}
																	return tStep
																}),
															})
														}}
													>
														👇
													</button>
													<button
														type="button"
														className="btn btn-sm btn-danger mr-2"
														onClick={() => setTestStep(step)}
													>
														📝
													</button>
													<button
														type="button"
														className="btn btn-sm btn-warning"
														onClick={() => runStep(step)}
													>
														Run
													</button>
												</div>
											</div>
										</div>
									))}

									<div className="d-flex justify-content-between">
										<button
											type="button"
											className="btn btn-primary"
											onClick={() => {
												const objectURL = URL.createObjectURL(
													new Blob(
														[
															[
																`/* eslint-disable */`,
																`const helpers = require('./helpers')`,
																``,
																`describe('${testFile.name}', () => {`,
																`\tit('${testFile.description}', () => {`,
																testFile.steps
																	.map((step, index) => {
																		const stepCode = generateCode(step)
																			.split('\n')
																			.map((l) => '\t\t' + l)
																			.join('\n')
																		if (
																			testFile.checksErrorsAfterEveryStep &&
																			index > 0
																		) {
																			return (
																				stepCode +
																				`\n\t\tcy.get('.alert-danger').should('not.exist')`
																			)
																		}
																		return stepCode
																	})
																	.filter((s) => s.trim())
																	.join('\n\n'),
																`\t})`,
																`})`,
																``,
																`module.exports = ${JSON.stringify(
																	testFile,
																	null,
																	'\t',
																)}`,
																``,
															].join('\n'),
														],
														{ type: 'text/plain' },
													),
												)
												const a = $(
													`<a href="${objectURL}" download="${testFile.name}" class="d-none"></a>`,
												)
													.appendTo('body')
													.get(0)
												a.click()
												$(a).remove()
												setTestFile()
											}}
										>
											Save file
										</button>
										{!runningState?.running && (
											<button
												type="button"
												className="btn btn-success"
												onClick={() => dispatch({ type: 'start' })}
											>
												Run steps
											</button>
										)}
										{runningState?.running && (
											<button
												type="button"
												className="btn btn-danger"
												onClick={() => dispatch({ type: 'stop' })}
											>
												Stop
											</button>
										)}
									</div>
								</div>
							)}

							{testStep && (
								<div className="py-4">
									<form
										className="w-100"
										onSubmit={(evt) => {
											evt.preventDefault()

											if (
												testFile.steps.find((step) => step.id === testStep.id)
											) {
												setTestFile({
													...testFile,
													steps: testFile.steps.map((step) => {
														if (step.id === testStep.id) {
															return testStep
														}
														return step
													}),
												})
											} else {
												const addedSteps = [testStep]
												const lastLocation = testFile.steps.reduce(
													(loc, step) => {
														if (step.action === 'location') {
															return step
														}
														return loc
													},
													null,
												)
												const pathname =
													iframeRef.current.contentWindow.location.pathname

												if (
													!lastLocation ||
													lastLocation.selector !== pathname
												) {
													addedSteps.unshift({
														id: uuid(),
														selectType: 'none',
														selector: pathname,
														action: 'location',
														args: {
															locationProperty: 'pathname',
														},
													})
												}

												setTestFile({
													...testFile,
													steps: [...testFile.steps, ...addedSteps],
												})
											}

											setTestStep()
											setActiveElm()
										}}
									>
										<div className="form-group">
											<RadioSwitch
												value={testStep.selectType === 'selector'}
												onChange={(useSelector) =>
													setTestStep({
														...testStep,
														selectType: useSelector ? 'selector' : 'content',
													})
												}
											>
												Use a selector
											</RadioSwitch>
										</div>

										{testStep.action !== 'reload' &&
											testStep.action !== 'reset' && (
												<React.Fragment>
													{(function () {
														try {
															return (
																$('iframe')
																	.contents()
																	.find(createSelector(testStep)).length >
																	1 && (
																	<Alert type="warning">
																		<strong>Warning:</strong> Your selector is
																		currently matching{' '}
																		{
																			$('iframe')
																				.contents()
																				.find(createSelector(testStep)).length
																		}{' '}
																		elements.
																	</Alert>
																)
															)
														} catch {
															return null
														}
													})()}

													<div className="form-group">
														<label className="col-form-label">
															{testStep.selectType === 'selector'
																? 'Selector'
																: 'Content'}
														</label>
														<input
															type="text"
															className="form-control"
															value={testStep.selector}
															onChange={(evt) => {
																setTestStep({
																	...testStep,
																	selector: evt.target.value,
																})
															}}
														/>
													</div>
												</React.Fragment>
											)}

										{testStep.action !== 'location' && (
											<div className="form-group">
												<label className="col-form-label">Action</label>
												<select
													className="form-control"
													value={testStep.action}
													onChange={(evt) => {
														setTestStep({
															...testStep,
															action: evt.target.value,
														})
													}}
												>
													<option value="click">click</option>
													<option value="type">type</option>
													<option value="select">select</option>
													<option value="exist">should exist</option>
													<option value="notExist">should not exist</option>
													<option value="disabled">should be disabled</option>
													<option value="notDisabled">should be enabled</option>
													<option value="reload">reload page</option>
													<option value="reset">reset tests</option>
													<option value="goto">goto page</option>
													<option value="xhr">wait for request</option>
												</select>
											</div>
										)}

										{testStep.action === 'location' && (
											<React.Fragment>
												<div className="form-group">
													<label className="col-form-label">
														Location property
													</label>
													<select
														className="form-control"
														value={testStep.args.locationProperty}
														onChange={(evt) => {
															setTestStep({
																...testStep,
																args: {
																	...testStep.args,
																	locationProperty: evt.target.value,
																},
															})
														}}
													>
														<option value="pathname">pathname</option>
														<option value="href">href</option>
													</select>
												</div>
												<div className="form-group">
													<label className="col-form-label">Match type</label>
													<select
														className="form-control"
														value={testStep.args.locationMatchType}
														onChange={(evt) => {
															setTestStep({
																...testStep,
																args: {
																	...testStep.args,
																	locationMatchType: evt.target.value,
																},
															})
														}}
													>
														<option value="startsWith">starts with</option>
														<option value="exact">is exactly</option>
													</select>
												</div>
											</React.Fragment>
										)}

										{testStep.action === 'type' && (
											<div className="form-group">
												<label className="col-form-label">Type content</label>
												<input
													type="text"
													className="form-control"
													value={testStep.args.typeContent ?? ''}
													onChange={(evt) => {
														setTestStep({
															...testStep,
															args: {
																...testStep.args,
																typeContent: evt.target.value,
															},
														})
													}}
												/>
											</div>
										)}

										{testStep.action === 'xhr' && (
											<React.Fragment>
												<div className="form-group">
													<label className="col-form-label">
														Request property
													</label>
													<select
														className="form-control"
														value={testStep.args.xhrProperty}
														onChange={(evt) => {
															setTestStep({
																...testStep,
																args: {
																	...testStep.args,
																	xhrProperty: evt.target.value,
																},
															})
														}}
													>
														<option value="href">href</option>
														<option value="pathname">pathname</option>
													</select>
												</div>
												<div className="form-group">
													<label className="col-form-label">
														Request method
													</label>
													<select
														className="form-control"
														value={testStep.args.xhrMethod}
														onChange={(evt) => {
															setTestStep({
																...testStep,
																args: {
																	...testStep.args,
																	xhrMethod: evt.target.value,
																},
															})
														}}
													>
														<option value="GET">GET</option>
														<option value="POST">POST</option>
														<option value="PUT">PUT</option>
														<option value="DELETE">DELETE</option>
													</select>
												</div>
											</React.Fragment>
										)}

										{testStep.action === 'select' && (
											<div className="form-group">
												<label className="col-form-label">Type content</label>
												<select
													className="form-control"
													value={testStep.args.typeContent ?? ''}
													onChange={(evt) => {
														setTestStep({
															...testStep,
															args: {
																...testStep.args,
																typeContent: evt.target.value,
															},
														})
													}}
												>
													{$('iframe')
														.contents()
														.find(createSelector(testStep))
														.find('option')
														.toArray()
														.map((option) => (
															<option value={option.value} key={option.value}>
																{option.innerHTML}
															</option>
														))}
												</select>
											</div>
										)}

										<div className="form-group">
											<code>
												<pre
													css={css`
														background-color: #000;
														padding: 1rem;
														border-radius: 10px;
														color: #fff;
													`}
													dangerouslySetInnerHTML={{
														__html: generateCode(testStep),
													}}
												/>
											</code>
										</div>

										<div className="form-group">
											<button
												type="submit"
												className="btn btn-block btn-primary"
											>
												{testFile.steps.find((step) => step.id === testStep.id)
													? 'Update step'
													: 'Add step'}
											</button>
											<button
												type="button"
												className="btn btn-block btn-danger"
												onClick={() => {
													setTestStep()
													setTestFile({
														...testFile,
														steps: testFile.steps.filter(
															(step) => step.id !== testStep.id,
														),
													})
												}}
											>
												Delete step
											</button>
											<button
												type="button"
												className="btn btn-block btn-secondary"
												onClick={() => {
													setTestStep()
													setActiveElm()
												}}
											>
												Cancel
											</button>
										</div>
									</form>
								</div>
							)}
						</React.Fragment>
					)}
				</div>

				<div className="col">
					<iframe
						ref={iframeRef}
						src={defaultSrc}
						frameBorder="0"
						className="w-100 h-100"
					></iframe>

					{mode === 'pointer' &&
						testFile &&
						testStep &&
						activeElm?.startX != null &&
						testStep?.action !== 'location' &&
						testStep?.action !== 'goto' &&
						testStep?.action !== 'reload' &&
						testStep?.action !== 'xhr' && (
							<React.Fragment>
								{/* top */}
								<div
									css={css`
										position: absolute;
										top: 0;
										left: ${activeElm.startX}px;
										width: ${activeElm.endX - activeElm.startX}px;
										height: ${activeElm.startY}px;
										background: rgba(0, 0, 0, 0.7);
									`}
								/>

								{/* bottom */}
								<div
									css={css`
										position: absolute;
										top: ${activeElm.endY}px;
										left: ${activeElm.startX}px;
										width: ${activeElm.endX - activeElm.startX}px;
										height: 100%;
										background: rgba(0, 0, 0, 0.7);
									`}
								/>

								{/* left */}
								<div
									css={css`
										position: absolute;
										top: 0;
										left: 0;
										width: ${activeElm.startX}px;
										height: 100%;
										background: rgba(0, 0, 0, 0.7);
									`}
								/>

								{/* right */}
								<div
									css={css`
										position: absolute;
										top: 0;
										left: ${activeElm.endX}px;
										width: 100%;
										height: 100%;
										background: rgba(0, 0, 0, 0.7);
									`}
								/>

								{/* focus box */}
								<div
									css={css`
										position: absolute;
										top: ${activeElm.startY}px;
										left: ${activeElm.startX}px;
										width: ${activeElm.endX - activeElm.startX}px;
										height: ${activeElm.endY - activeElm.startY}px;
										border: solid 3px #fff;
									`}
								/>
							</React.Fragment>
						)}

					{mode === 'pointer' && (
						<div
							className="w-100 h-100 position-absolute"
							css={css`
								top: 0;
								right: 0;
							`}
							onClick={(evt) => {
								if (!testFile) {
									return
								}

								const offset = $(iframeRef.current).offset().left

								const pageX = evt.pageX - offset
								const pageY = evt.pageY

								// The goal is to locate the 'data-test' element that has a
								// midpoint which is closest to the click
								let selectedElm = [Infinity, null]
								for (const elm of $(iframeRef.current)
									.contents()
									.find(
										'[data-test], input, button, .alert, a, p, h1, h2, h3, h4, h5, h6',
									)
									.toArray()) {
									const elmX = $(elm).offset().left + $(elm).outerWidth() / 2
									const elmY = $(elm).offset().top + $(elm).outerHeight() / 2

									const dist = Math.sqrt(
										(elmX - pageX) ** 2 + (elmY - pageY) ** 2,
									)
									if (dist <= selectedElm[0] && dist <= 200) {
										selectedElm = [dist, elm]
									}
								}

								const activeElm = $(selectedElm[1])

								if (activeElm.length > 0) {
									const updatedStep = {
										...(testStep ?? {}),
										id: testStep?.id ?? uuid(),
										selectType: 'selector',
										selector: `[data-test="${activeElm.attr('data-test')}"]`,
										action: 'exist',
										args: {
											typeContent: '',
											locationProperty: 'pathname',
											emailProperty: 'to',
											emailAssertionType: 'exactly',
											xhrMethod: 'GET',
											xhrProperty: 'href',
										},
									}

									if (activeElm.is('input')) {
										updatedStep.action = 'type'
									} else if (activeElm.is('select')) {
										updatedStep.action = 'select'
									} else if (activeElm.is('button, .btn, a')) {
										updatedStep.action = 'click'
									}

									if (!activeElm.attr('data-test')) {
										if (activeElm.is('a')) {
											updatedStep.selector = `[href="${activeElm.attr(
												'href',
											)}"]`
										} else if (
											activeElm.is('.alert, p, h1, h2, h3, h4, h5, h6')
										) {
											updatedStep.selectType = 'content'
											updatedStep.selector = activeElm.text()
										}
									} else if (
										$(iframeRef.current)
											.contents()
											.find(`[data-test="${activeElm.attr('data-test')}"]`)
											.length > 1
									) {
										const parent = activeElm.parents('[data-test]').get(0)
										if (parent) {
											updatedStep.selector = `[data-test="${$(parent).attr(
												'data-test',
											)}"] ${updatedStep.selector}`
										}
									}

									setTestStep(updatedStep)
								}
							}}
						></div>
					)}
				</div>
			</div>
		</div>
	)
}
TestHelperChild.propTypes = {
	initialSteps: PropTypes.array.isRequired,
	execStep: PropTypes.func.isRequired,
	verifyTestMode: PropTypes.func.isRequired,
	baseURL: PropTypes.string.isRequired,
	onEnvReset: PropTypes.func.isRequired,
	defaultPathname: PropTypes.string.isRequired,
	isXHRAllowed: PropTypes.func.isRequired,
}

export function CyBuddy(props) {
	const testModeState = useAsync(props.verifyTestMode)

	if (testModeState.status === 'inprogress') {
		return (
			<div className="h-100 w-100 d-flex align-items-center justify-content-center">
				<Spinner size="lg" />
			</div>
		)
	}
	if (testModeState.error || !testModeState.result) {
		return (
			<div className="h-100 w-100 d-flex align-items-center justify-content-center">
				<Alert type="danger">
					{String(
						!testModeState.result
							? 'The API is not running in test mode, which can cause real data to be written.'
							: testModeState.error,
					)}
				</Alert>
			</div>
		)
	}

	const childProps = {
		...props,
		onEnvReset: props.onEnvReset ?? noop,
		isXHRAllowed: props.isXHRAllowed ?? (() => true),
		defaultPathname: props.defaultPathname ?? '/',
		execStep: null,
	}
	childProps.execStep = execStepUnbound.bind(null, childProps)

	return <TestHelperChild {...childProps} />
}
CyBuddy.propTypes = {
	verifyTestMode: PropTypes.func.isRequired,
	baseURL: PropTypes.string.isRequired,

	onEnvReset: PropTypes.func,
	isXHRAllowed: PropTypes.func,
	defaultPathname: PropTypes.string,
}
