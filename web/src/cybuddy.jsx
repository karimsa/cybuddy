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

import imgLogo from './logo.svg'
import { RadioSwitch } from './radio-switch'
import { Alert } from './alert'
import { Spinner } from './spinner'
import {
	useLocalState,
	useReducer,
	useAsyncAction,
	useAPI,
	useAsync,
} from './hooks'
import {
	onXHRRequest,
	createBuiltinActions,
	createSelector,
	runProxyStep,
} from './actions'
import { ButtonDropdown } from './button-dropdown'
import { useFileOpenMenu } from './file-open-menu'

// Useful for debugging
window.$ = window.jQuery = $

function shorten(text, maxlen) {
	if (text.length > maxlen) {
		return text.substr(0, maxlen) + '...'
	}
	return text
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
			<ButtonDropdown
				variant="success"
				className="btn-block mt-2"
				isLoading={isValidating}
				disabled={disabled}
				choices={
					templates ? templates.map((template) => [template, template]) : []
				}
				onSelect={openTemplate}
			>
				Create test from template
			</ButtonDropdown>

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

function Header({ isLoading }) {
	return (
		<React.Fragment>
			<h1 className="text-center mb-4 d-flex align-items-center justify-content-center">
				{isLoading && <Spinner />}
				<img
					src={imgLogo}
					width="80"
					className={(isLoading ? 'ml-4' : '') + ' mr-2'}
				/>
				<span>CyBuddy</span>
			</h1>
		</React.Fragment>
	)
}
Header.propTypes = {
	isLoading: PropTypes.bool.isRequired,
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
	// const openFileRef = createRef()
	const downloadFileRef = createRef()
	const [defaultSrc] = useLocalState(
		'test:iframeSrc',
		new URL(defaultPathname, baseURL).href,
	)
	const [testFile, setTestFile] = useLocalState('test:file')
	const [mode, setMode] = useLocalState('test:mode', 'navigation')
	const [activeElm, setActiveElm] = useLocalState('test:activeElm')
	const [testStep, setTestStep] = useLocalState('test:step')
	const [
		saveTemplateState,
		{ fetch: saveTemplate, reset: resetSaveTemplateState },
	] = useAsyncAction((testFile) => {
		return axios.post('/api/templates', testFile)
	})

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

	const [runState, { fetch: runStep, reset: resetRunState }] = useAsyncAction(
		async (step) => {
			return execStep(step, iframeRef.current)
		},
	)
	useEffect(() => {
		if (runState.error) {
			dispatch({ type: 'setError', error: runState.error })
		} else {
			dispatch({ type: 'stop' })
		}
	}, [runState.status])

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
			const iframe = iframeRef.current
			injectXHR({ target: iframe })
			iframe.addEventListener('load', injectXHR)
			return () => {
				iframe.removeEventListener('load', injectXHR)
			}
		}
	}, [iframeRef.current])
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

	const [
		saveTestFileState,
		{ fetch: saveTestFile, reset: resetSaveTestFileState },
	] = useAsyncAction(async () => {
		const testFileCode = [
			`/* eslint-disable */`,
			`const helpers = require('@karimsa/cybuddy/helpers')`,
			``,
			`describe('${testFile.name}', () => {`,
			`\tit('${testFile.description}', () => {`,
			`\t\tCypress.config('baseUrl', '${baseURL}')`,
			`\t\tcy.visit('${defaultPathname}')`,
		]

		for (
			let i = 0, step = testFile.steps[0];
			i < testFile.steps.length;
			step = testFile.steps[++i]
		) {
			const stepCode = (await generateCode(step))
				.split('\n')
				.map((l) => '\t\t' + l)
				.join('\n')
			if (testFile.checksErrorsAfterEveryStep && i > 0) {
				testFileCode.push(
					stepCode + `\n\t\tcy.get('.alert-danger').should('not.exist')`,
				)
			} else {
				testFileCode.push(stepCode)
			}
		}

		testFileCode.push(
			`\t})`,
			`})`,
			``,
			`module.exports = ${JSON.stringify(testFile, null, '\t')}`,
			``,
		)

		const objectURL = URL.createObjectURL(
			new Blob([testFileCode.join('\n')], { type: 'text/plain' }),
		)

		$(downloadFileRef.current)
			.attr('download', testFile.name)
			.attr('href', objectURL)

		if (!window.Cypress) {
			downloadFileRef.current.click()
		}

		setTestFile()
		setMode('navigation')
	})

	const stepPreviewState = useAsync(generateCode, [testStep])

	const [openFileState, fileOpenActions, FileOpenMenu] = useFileOpenMenu()
	useEffect(() => {
		if (openFileState.result) {
			setTestFile(openFileState.result)
		}
	}, [openFileState.result])

	const error =
		openFileState.error ||
		saveTemplateState.error ||
		saveTestFileState.error ||
		runState.error ||
		runningState?.error
	function resetError() {
		fileOpenActions.reset()
		resetSaveTemplateState()
		resetSaveTestFileState()
		resetRunState()
		dispatch({ type: 'setError' })
	}

	const testStepIsSaved =
		testStep && testFile.steps.find((step) => step.id === testStep.id)
	const isLoading =
		saveTemplateState.status === 'inprogress' ||
		openFileState.status === 'inprogress' ||
		runState.status === 'inprogress' ||
		saveTestFileState.status === 'inprogress'
	const testStepAction =
		testStep && actions.find((action) => action.action === testStep.action)

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

							{FileOpenMenu}

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
																step.comment ??
																	(step.action === 'type'
																		? step.args.typeContent
																		: step.selector),
																25,
															)}
														</span>
													)}
												<div className="mt-2 text-center">
													<button
														type="button"
														className="btn btn-sm btn-info mr-2"
														disabled={isLoading}
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
														disabled={isLoading}
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
														disabled={isLoading}
														onClick={() => setTestStep(step)}
													>
														📝
													</button>
													<button
														type="button"
														className="btn btn-sm btn-warning"
														disabled={isLoading}
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
										{error && (
											<Alert
												type="danger"
												dismissable={true}
												className="mb-4"
												onDismiss={resetError}
											>
												{String(error).split('\n')[0]}
											</Alert>
										)}

										<div className="d-flex justify-content-between">
											<ButtonDropdown
												variant="primary"
												isLoading={
													saveTestFileState.status === 'inprogress' ||
													saveTemplateState.status === 'inprogress'
												}
												disabled={isLoading}
												choices={[
													['testFile', 'as test file'],
													['template', 'as template'],
												]}
												onSelect={(key) =>
													key === 'testFile' ? saveTestFile() : saveTemplate()
												}
											>
												Save file
											</ButtonDropdown>

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

										<div className="form-group">
											<label className="col-form-lab">Comment</label>
											<input
												data-test="input-comment"
												type="text"
												className="form-control"
												value={testStep.comment ?? testStep.selector}
												onChange={(evt) => {
													setTestStep({
														...testStep,
														comment: evt.target.value,
													})
												}}
											/>
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
												>
													{stepPreviewState.error
														? String(stepPreviewState.error)
																.split('\n')
																.map((line) => '// ' + line)
																.join('\n')
														: stepPreviewState.result ?? '// Loading preview'}
												</pre>
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
	execStep: PropTypes.func.isRequired,
	generateCode: PropTypes.func.isRequired,
	baseURL: PropTypes.string.isRequired,
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

	const target = new URL(data.targetUrl)
	const config = {
		originHost: target.host,
		baseURL: `http://${location.host}`,
		defaultPathname: target.pathname,
	}
	const builtinActions = createBuiltinActions(config)
	const actions = builtinActions.concat(data.actions ?? [])
	const serverActions = new Set(data.actions.map((action) => action.action))
	const childProps = {
		isXHRAllowed: () => true,
		baseURL: config.baseURL,
		defaultPathname: config.defaultPathname,
		actions,
		generateCode: async (testStep) => {
			if (serverActions.has(testStep.action)) {
				const {
					data: { code },
				} = await axios.post(
					`/api/actions/${testStep.action}/generate`,
					testStep,
				)
				return code
			}

			const action = actions.find((action) => action.action === testStep.action)
			if (!action) {
				throw new Error(
					`Unrecognized action specified by step: ${testStep.action}`,
				)
			}
			if (!action.generateCode) {
				throw new Error(
					`Action '${testStep.action}' does not implement .generateCode()`,
				)
			}
			return [
				testStep.comment && `// ${testStep.comment}`,
				action.generateCode(testStep),
			]
				.filter(Boolean)
				.join('\n')
		},
		execStep: async (testStep, iframe) => {
			if (serverActions.has(testStep.action)) {
				const { data: steps } = await axios.post(
					`/api/actions/${testStep.action}/run`,
					testStep,
				)
				steps.forEach((step) => {
					runProxyStep(step, iframe, config)
				})
				return
			}

			const action = actions.find((action) => action.action === testStep.action)
			if (!action) {
				throw new Error(
					`Unrecognized action specified by step: ${testStep.action}`,
				)
			}
			if (!action.runStep) {
				throw new Error(
					`Action '${testStep.action}' does not implement .runStep()`,
				)
			}
			return action.runStep(testStep, iframe)
		},
	}

	return <TestHelperChild {...childProps} />
}
