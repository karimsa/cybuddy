/* eslint-env mocha */
/* globals Cypress, cy */

const cyHelpers = require('../../dist/helpers')

Cypress.Commands.add('iframe', () => {
	return cy.get('iframe').its('0.contentDocument.body').then(cy.wrap)
})

Cypress.Commands.add('saveAndRunTest', () => {
	// Force file download, but then catch the file from the anchor
	cy.contains('Save file').click()

	// Small delay to ensure that the href is updated
	cy.wait(500)

	// Double-checking that href exists on query
	cy.get('[data-test="save-file"][href^="blob:"]')
		.then(async (a) => {
			const res = await fetch(a.attr('href'))
			const blob = await res.blob()
			return new Promise((resolve) => {
				const fileReader = new FileReader()
				fileReader.onloadend = () => resolve(fileReader.result)
				fileReader.readAsText(blob)
			})
		})
		.then((code) => {
			// eslint-disable-next-line
			const runTest = new Function('require', 'module', 'describe', 'it', code)
			runTest(
				// It should only be importing from helpers, which we can share
				// from the source copy
				(path) => {
					if (path === '@karimsa/cybuddy/helpers') {
						return cyHelpers
					}
					throw new Error(`Unrecognized module: ${path}`)
				},

				// module must be declared, since the file will try to export
				// a JSON object to use for imports
				{},

				// describe() and it() should be run immediately, and joined
				// to current test
				(_, fn) => fn(),
				(_, fn) => fn(),
			)
		})
})
