import $ from 'jquery'
import Cookies from 'js-cookie'

const iframeXHREvents = []

export function onXHRRequest(event) {
	iframeXHREvents.push(event)
}

export function createSelector(testStep) {
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

const createCyProxy = (iframe, { originHost }) => ({
	visit(href) {
		const target = new URL(href)
		if (originHost !== target.host) {
			throw new Error(
				`cy.visit() tried to access different domain (${target.host})`,
			)
		}

		iframe.src = href
	},
	clearCookies() {
		for (const key in Cookies.get()) {
			Cookies.remove(key)
		}
	},
	clearLocalStorage() {
		const keys = []
		for (let i = 0; i < iframe.contentWindow.localStorage.length; i++) {
			if (!iframe.contentWindow.localStorage.key(i).startsWith('test:')) {
				keys.push(iframe.contentWindow.localStorage.key(i))
			}
		}
		for (const key of keys) {
			iframe.contentWindow.localStorage.removeItem(key)
		}
	},
})

export function runProxyStep({ method, args, chain }, iframe, config) {
	const cy = createCyProxy(iframe, config)

	if (!cy[method]) {
		throw new Error(`cy.${method}() is not a function`)
	}
	let ctx = cy[method].apply(cy, args)
	const chained = [method]

	for (const { method, args } of chain) {
		if (!ctx[method][method]) {
			throw new Error(
				`cy.${chained.map((m) => '.' + m + '()').join('')} is not a function`,
			)
		}
		ctx = ctx[method].apply(ctx, args)
		chained.push(method)
	}
}

export const createBuiltinActions = (config) => [
	{
		action: 'reset',
		label: 'resets the state',
		hideSelectorInput: true,
		params: [],
		generateCode: () =>
			[
				`cy.clearCookies()`,
				`cy.clearLocalStorage()`,
				`cy.visit(${new URL(config.defaultPathname, config.baseURL).href})`,
			].join('\n'),
		runStep(_, iframe) {
			const cy = createCyProxy(iframe)
			cy.clearCookies()
			cy.clearLocalStorage()
			cy.visit(new URL(config.defaultPathname, config.baseURL).href)
		},
	},
	{
		action: 'type',
		label: 'enter value into input',
		params: [
			{
				key: 'typeContent',
				type: 'string',
				label: 'Type Content',
			},
		],
		generateCode: (testStep) =>
			`cy.get('${testStep.selector}').clear().type('${testStep.args.typeContent}')`,
		runStep: (testStep, iframe) =>
			setInputValue(
				$(iframe).contents().find(createSelector(testStep)).get(0),
				testStep.args.typeContent,
			),
	},
	{
		action: 'click',
		label: 'click element',
		generateCode(testStep) {
			if (testStep.selectType === 'content') {
				return `cy.contains('${testStep.selector}').click()`
			}
			return `cy.get('${testStep.selector}').click()`
		},
		runStep: (testStep, iframe) => {
			const elm = $(iframe).contents().find(createSelector(testStep)).get(0)
			if (!elm) {
				throw new Error(
					`No element found matching selector: ${createSelector(testStep)}`,
				)
			}
			elm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		},
	},
	{
		action: 'location',
		label: 'verify page location',
		params: [
			{
				key: 'locationProperty',
				label: 'Location property',
				type: 'select',
				options: ['pathname', 'href'],
			},
			{
				label: 'Match type',
				key: 'locationMatchType',
				type: 'select',
				options: [
					{
						key: 'startsWith',
						label: 'starts with',
					},
					{
						key: 'exact',
						label: 'is exactly',
					},
				],
			},
		],
		generateCode: (testStep) => {
			if (testStep.args.locationMatchType === 'startsWith') {
				return `cy.location('${testStep.args.locationProperty}').should('match', new RegExp('^${testStep.selector}'))`
			}
			return `cy.location('${testStep.args.locationProperty}').should('eq', '${testStep.selector}')`
		},
		runStep: (testStep, iframe) => {
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
		},
	},
	{
		action: 'exist',
		label: 'should exist',
		generateCode(testStep) {
			if (testStep.selectType === 'content') {
				return `cy.contains('${testStep.selector}')`
			}
			return `cy.get('${testStep.selector}')`
		},
		runStep: (testStep, iframe) => {
			if ($(iframe).contents().find(createSelector(testStep)).length === 0) {
				throw new Error(
					`Could not find element matching: '${testStep.selector}'`,
				)
			}
		},
	},
	{
		action: 'notExist',
		label: 'should not exist',
		generateCode(testStep) {
			if (testStep.selectType === 'content') {
				return `cy.contains('${testStep.selector}').should('not.exist')`
			}
			return `cy.get('${testStep.selector}').should('not.exist')`
		},
		runStep: (testStep, iframe) => {
			if ($(iframe).contents().find(createSelector(testStep)).length > 0) {
				throw new Error(
					`Found element matching: '${testStep.selector}' (should not exist)`,
				)
			}
		},
	},
	{
		action: 'contains',
		label: 'should contain',
		params: [
			{
				key: 'textContent',
				type: 'string',
				label: 'Text content',
			},
		],
		generateCode: (testStep) =>
			`cy.get('${testStep.selector}').contains('${testStep.args.textContent}')`,
		runStep: (testStep, iframe) => {
			if (
				!$(iframe)
					.contents()
					.find(createSelector(testStep))
					.is(`*:contains(${testStep.args.textContent})`) &&
				$(iframe)
					.contents()
					.find(createSelector(testStep))
					.find(`*:contains(${testStep.args.textContent})`).length === 0
			) {
				throw new Error(
					`Could not find content '${testStep.args.textContent}' in '${testStep.selector}'`,
				)
			}
		},
	},
	{
		action: 'goto',
		label: 'goto a page',
		generateCode: (testStep) => `cy.visit('${testStep.selector}')`,
		runStep: (testStep, iframe) => {
			iframe.src = new URL(testStep.selector, iframe.src).href
		},
	},
	{
		action: 'select',
		label: 'select value from dropdown',
		params: [
			{
				key: 'typeContent',
				type: 'string',
				label: 'Type content',
			},
		],
		generateCode: (testStep) =>
			`cy.get('${testStep.selector}').select('${testStep.args.typeContent}')`,
		runStep: (testStep, iframe) =>
			setInputValue(
				$(iframe).contents().find(createSelector(testStep)).get(0),
				testStep.args.typeContent,
			),
	},
	{
		action: 'reload',
		label: 'refresh the page',
		hideSelectorInput: true,
		generateCode: () => `cy.reload()`,
		runStep: (_, iframe) => {
			iframe.contentWindow.location.reload()
		},
	},
	{
		action: 'xhr',
		label: 'wait for request',
		params: [
			{
				key: 'xhrMethod',
				label: 'Method',
				type: 'select',
				options: ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'],
			},
			{
				key: 'xhrProperty',
				label: 'Request property',
				type: 'select',
				options: ['href', 'pathname'],
			},
		],
		generateCode: (testStep) =>
			[
				`helpers.waitForXHR({`,
				`\tid: '${testStep.id}',`,
				`\tmethod: '${testStep.args.xhrMethod}',`,
				`\tproperty: '${testStep.args.xhrProperty}',`,
				`\tvalue: '${testStep.selector}',`,
				`})`,
			].join('\n'),
		runStep: (testStep) => {
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
		},
	},
	{
		action: 'disabled',
		label: 'should be disabled',
		generateCode: (testStep) => {
			if (testStep.selectType === 'content') {
				return `cy.contains('${testStep.selector}').should('be.disabled')`
			}
			return `cy.get('${testStep.selector}').should('be.disabled')`
		},
		runStep: (testStep, iframe) => {
			if (
				!$(iframe).contents().find(createSelector(testStep)).is(':disabled')
			) {
				throw new Error(`'${testStep.selector}' is not disabled (should be)`)
			}
		},
	},
	{
		action: 'notDisabled',
		label: 'should not be disabled',
		generateCode: (testStep) => {
			if (testStep.selectType === 'content') {
				return `cy.contains('${testStep.selector}').should('not.be.disabled')`
			}
			return `cy.get('${testStep.selector}').should('not.be.disabled')`
		},
		runStep: (testStep, iframe) => {
			if ($(iframe).contents().find(createSelector(testStep)).is(':disabled')) {
				throw new Error(`'${testStep.selector}' is disabled (should not be)`)
			}
		},
	},
	{
		action: 'code',
		label: 'custom code block',
		params: [
			{
				key: 'codeBlock',
				label: 'Custom code',
				defaultValue: `console.log('hello, world')`,
			},
		],
		generateCode(testStep) {
			return testStep.args.codeBlock
		},
		runStep(testStep) {
			// eslint-disable-next-line
			eval(testStep.args.codeBlock)
		},
	},
]
