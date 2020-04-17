/** @jsx jsx */

import 'bootstrap/dist/css/bootstrap.min.css'
import 'babel-polyfill'
import $ from 'jquery'
import 'bootstrap/dist/js/bootstrap.min.js'
import React, { useEffect, createRef } from 'react'
import { css, jsx } from '@emotion/core'
import { v4 as uuid } from 'uuid'
import PropTypes from 'prop-types'
import axios from 'axios'
import { trigger } from 'swr'

import { RadioSwitch } from './radio-switch'
import { Alert } from './alert'
import { Spinner } from './spinner'
import { useLocalState, useReducer, useAsyncAction, useAPI } from './hooks'
import { onXHRRequest, builtinActions, createSelector } from './actions'

function shorten(text, maxlen) {
	if (text.length > maxlen) {
		return text.substr(0, maxlen) + '...'
	}
	return text
}

function noop() {
	// NO-OP
}

function ActionParamInput({ param, testStep, setTestStep }) {
	function onChange(evt) {
		setTestStep({
			...testStep,
			args: {
				...testStep.args,
				[param.key]: evt.target.value,
			},
		})
	}

	return (
		<div className="form-group">
			<label className="col-form-label">{param.label ?? param.key}</label>
			{param.type === 'select' ? (
				<select
					className="form-control"
					value={testStep.args[param.key] ?? param.defaultValue}
					onChange={onChange}
				>
					{param.options.map((option) => (
						<option key={option?.key ?? option} value={option?.key ?? option}>
							{option?.label ?? option?.key ?? option}
						</option>
					))}
				</select>
			) : (
				<input
					type={param.type}
					className="form-control"
					value={testStep.args[param.key] ?? param.defaultValue}
					onChange={onChange}
				/>
			)}
		</div>
	)
}
ActionParamInput.propTypes = {
	param: PropTypes.shape({
		type: PropTypes.string.isRequired,
		key: PropTypes.string.isRequired,
		label: PropTypes.string.isRequired,
		defaultValue: PropTypes.string,
		options: PropTypes.arrayOf(
			PropTypes.oneOfType([
				PropTypes.string.isRequired,
				PropTypes.shape({
					key: PropTypes.string.isRequired,
					label: PropTypes.string.isRequired,
				}).isRequired,
			]),
		),
	}).isRequired,
	testStep: PropTypes.object.isRequired,
	setTestStep: PropTypes.func.isRequired,
}

function CreateFromTemplate({ onOpen, disabled }) {
	const { data: templates, isValidating, error } = useAPI('/api/templates')
	const [templateContentsState, { fetch: openTemplate }] = useAsyncAction(
		async (template) => {
			const { data } = await axios.get(`/api/template/${template}`)
			return data
		},
	)
	useEffect(() => {
		if (templateContentsState.result) {
			console.warn(templateContentsState.result)
			onOpen(templateContentsState.result)
		}
	}, [templateContentsState.result])

	if (templates?.length === 0) {
		return null
	}

	return (
		<React.Fragment>
			<div className="dropdown btn-block mt-2">
				<button
					type="button"
					className="btn btn-block btn-success dropdown-toggle d-flex align-items-center justify-content-center"
					disabled={disabled || isValidating}
					data-toggle="dropdown"
				>
					{(isValidating || templateContentsState.status === 'inprogress') && (
						<Spinner color="light" />
					)}
					<span className="ml-2">Create test from template</span>
				</button>

				<div className="dropdown-menu">
					{templates &&
						templates.map((template) => (
							<a
								key={template}
								href="#"
								className="dropdown-item"
								onClick={(evt) => {
									evt.preventDefault()
									openTemplate(template)
								}}
							>
								{template}
							</a>
						))}
				</div>
			</div>

			{(error || templateContentsState.error) && (
				<div className="mt-4">
					<Alert type="danger">
						{String(error || templateContentsState.error)}
					</Alert>
				</div>
			)}
		</React.Fragment>
	)
}
CreateFromTemplate.propTypes = {
	onOpen: PropTypes.func.isRequired,
	disabled: PropTypes.bool,
}

function Header({ isLoading, error }) {
	return (
		<React.Fragment>
			<h1 className="text-center mb-4 d-flex align-items-center justify-content-center">
				{isLoading && <Spinner />}
				<span className={isLoading ? 'ml-4' : ''}>CyBuddy</span>
			</h1>
			{error && (
				<div className="mb-4">
					<Alert type="danger">{String(error).split('\n')[0]}</Alert>
				</div>
			)}
		</React.Fragment>
	)
}
Header.propTypes = {
	isLoading: PropTypes.bool.isRequired,
	error: PropTypes.any,
}

function TestHelperChild({
	baseURL,
	defaultPathname,
	isXHRAllowed,
	generateCode,
	execStep,
	actions,
}) {
	const iframeRef = createRef()
	const openFileRef = createRef()
	const downloadFileRef = createRef()
	const [defaultSrc] = useLocalState(
		'test:iframeSrc',
		new URL(defaultPathname, baseURL).href,
	)
	const [testFile, setTestFile] = useLocalState('test:file')
	const [mode, setMode] = useLocalState('test:mode', 'navigation')
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
	const [saveTemplateState, { fetch: saveTemplate }] = useAsyncAction(
		(testFile) => {
			return axios.post('/api/templates', testFile)
		},
	)

	useEffect(() => {
		if (saveTemplateState.status === 'success') {
			trigger('/api/templates')
			setTestFile()
			setMode('navigation')
		}
	}, [saveTemplateState])

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
					onXHRRequest(xhr)
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

	// Special case for 'select' action: populate the dropdown magically
	useEffect(() => {
		if (testStep?.action === 'select') {
			const selectAction = actions.find((action) => action.action === 'select')
			selectAction.params[0].options = $('iframe')
				.contents()
				.find(createSelector(testStep))
				.find('option')
				.toArray()
				.map((option) => ({
					key: option.value,
					label: option.innerText,
				}))
		}
	}, [testStep?.action === 'select'])

	const testStepIsSaved =
		testStep && testFile.steps.find((step) => step.id === testStep.id)
	const isLoading =
		saveTemplateState.status === 'inprogress' ||
		openFile.status === 'inprogress'
	const error = openFile.error || saveTemplateState.error
	const testStepAction =
		testStep && actions.find((action) => action.action === testStep.action)

	function saveTestFile() {
		const objectURL = URL.createObjectURL(
			new Blob(
				[
					[
						`/* eslint-disable */`,
						`const helpers = require('@karimsa/cybuddy/helpers')`,
						``,
						`describe('${testFile.name}', () => {`,
						`\tit('${testFile.description}', () => {`,
						`\t\tCypress.config('baseUrl', '${baseURL}')`,
						`\t\tcy.visit('${defaultPathname}')`,
						testFile.steps
							.map((step, index) => {
								const stepCode = generateCode(step)
									.split('\n')
									.map((l) => '\t\t' + l)
									.join('\n')
								if (testFile.checksErrorsAfterEveryStep && index > 0) {
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
						`module.exports = ${JSON.stringify(testFile, null, '\t')}`,
						``,
					].join('\n'),
				],
				{ type: 'text/plain' },
			),
		)

		$(downloadFileRef.current)
			.attr('download', testFile.name)
			.attr('href', objectURL)

		if (!window.Cypress) {
			downloadFileRef.current.click()
		}

		setTestFile()
		setMode('navigation')
	}

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
							<Header isLoading={isLoading} error={error} />

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
								disabled={isLoading}
							>
								Open test
							</button>

							<button
								type="button"
								className="btn btn-block btn-warning"
								onClick={() => {
									runStep({
										action: 'reset',
									})
									setMode('pointer')
									setTestFile({
										name: 'untitled.spec.js',
										description: 'should work',
										checksErrorsAfterEveryStep: true,
										steps: [],
									})
								}}
								disabled={isLoading}
							>
								Create new empty test
							</button>

							<CreateFromTemplate
								disabled={isLoading}
								onOpen={({ steps }) => {
									setMode('pointer')
									setTestFile({
										name: 'untitled.spec.js',
										description: 'should work',
										checksErrorsAfterEveryStep: true,
										steps,
									})
								}}
							/>
						</div>
					)}

					{/* Used later for downloading files, but must exist outside of testStep context */}
					<a
						data-test="save-file"
						ref={downloadFileRef}
						href="#"
						className="d-none"
					/>

					{testFile && (
						<React.Fragment>
							<Header isLoading={isLoading} error={error} />

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
								<div
									className="mt-4 mb-5"
									css={css`
										padding-bottom: 9rem;
									`}
								>
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

									<div
										className="position-fixed col-4 col-xl-3 p-4 bg-dark"
										css={css`
											bottom: 0;
											left: 0;
										`}
									>
										{runningState?.error && (
											<Alert type="danger" dismissable={true} className="mb-4">
												{String(runningState.error)}
											</Alert>
										)}

										<div className="d-flex justify-content-between">
											<div className="dropdown">
												<button
													type="button"
													className="btn btn-primary dropdown-toggle d-flex align-items-center justify-content-center"
													disabled={isLoading}
													data-toggle="dropdown"
												>
													{saveTemplateState.status === 'inprogress' && (
														<Spinner color="light" />
													)}
													<span
														className={
															saveTemplateState.status === 'inprogress'
																? 'ml-2'
																: ''
														}
													>
														Save file
													</span>
												</button>

												<div className="dropdown-menu">
													<a
														href="#"
														className="dropdown-item"
														onClick={(evt) => {
															evt.preventDefault()
															saveTestFile()
														}}
													>
														as test file
													</a>
													<a
														href="#"
														className="dropdown-item"
														onClick={(evt) => {
															evt.preventDefault()
															saveTemplate()
														}}
													>
														as template
													</a>
												</div>
											</div>

											{!runningState?.running && (
												<button
													disabled={isLoading}
													type="button"
													className="btn btn-success"
													onClick={() => dispatch({ type: 'start' })}
												>
													Run steps
												</button>
											)}
											{runningState?.running && (
												<button
													disabled={isLoading}
													type="button"
													className="btn btn-danger"
													onClick={() => dispatch({ type: 'stop' })}
												>
													Stop
												</button>
											)}
										</div>
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
												data-test="checkbox-use-selector"
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

										{!testStepAction?.hideSelectorInput && (
											<React.Fragment>
												{(function () {
													try {
														return (
															$('iframe')
																.contents()
																.find(createSelector(testStep)).length > 1 && (
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
														data-test="input-selector"
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

										<div className="form-group">
											<label className="col-form-label">Action</label>
											<select
												data-test="input-action"
												className="form-control"
												value={testStep.action}
												onChange={(evt) => {
													setTestStep({
														...testStep,
														action: evt.target.value,
													})
												}}
											>
												{actions.map((action) => (
													<option value={action.action} key={action.action}>
														{action.label}
													</option>
												))}
											</select>
										</div>

										{testStepAction?.params &&
											testStepAction.params.map((param) => {
												if (
													param.defaultValue != null &&
													testStep.args[param.key] == null
												) {
													setTestStep({
														...testStep,
														args: {
															...testStep.args,
															[param.key]: param.defaultValue,
														},
													})
												}
												return (
													<ActionParamInput
														key={param.key}
														param={param}
														testStep={testStep}
														setTestStep={setTestStep}
													/>
												)
											})}

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
												{testStepIsSaved ? 'Update step' : 'Add step'}
											</button>
											{testStepIsSaved && (
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
											)}
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
							data-test="pointer-overlay"
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
	generateCode: PropTypes.func.isRequired,
	verifyTestMode: PropTypes.func.isRequired,
	baseURL: PropTypes.string.isRequired,
	onEnvReset: PropTypes.func.isRequired,
	defaultPathname: PropTypes.string.isRequired,
	isXHRAllowed: PropTypes.func.isRequired,
	actions: PropTypes.array.isRequired,
}

export function CyBuddy() {
	const { data, error } = useAPI('/api/init')

	if (!data && !error) {
		return (
			<div className="h-100 w-100 d-flex align-items-center justify-content-center">
				<Spinner size="lg" />
			</div>
		)
	}
	if (error) {
		return (
			<div className="h-100 w-100 d-flex align-items-center justify-content-center">
				<Alert type="danger">
					{String(
						String(error).includes('not running in test mode')
							? 'The API is not running in test mode, which can cause real data to be written.'
							: error,
					)}
				</Alert>
			</div>
		)
	}

	// TODO: Load custom actions from server
	const actions = builtinActions.concat([] ?? [])
	const target = new URL(data.targetUrl)
	const childProps = {
		isXHRAllowed: () => true,
		baseURL: `http://${location.host}`,
		defaultPathname: target.pathname,
		actions,
		generateCode: (testStep) => {
			const action = actions.find((action) => action.action === testStep.action)
			if (!action) {
				throw new Error(
					`Unrecognized action specified by step: ${testStep.action}`,
				)
			}
			return action.generateCode(testStep)
		},
		execStep: (testStep) => {
			const action = actions.find((action) => action.action === testStep.action)
			if (!action) {
				throw new Error(
					`Unrecognized action specified by step: ${testStep.action}`,
				)
			}
			return action.runStep(testStep, $('iframe').get(0))
		},
	}

	return <TestHelperChild {...childProps} />
}
