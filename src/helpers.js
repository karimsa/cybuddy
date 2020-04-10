/* globals Cypress, cy */
/* eslint-env mocha */

try {
	const _ = Cypress.env
} catch (error) {
	throw new Error(`helpers were imported in a non-cypress environment`)
}

const API_URL = Cypress.env('API_URL')

beforeEach(() => {
	cy.request('POST', `${API_URL}/api/v0/testing/reset-db`)
	cy.server()
	cy.clearCookies()
	cy.clearLocalStorage()
})

export function waitForXHR({ id, method, property, value }) {
	if (property === 'href') {
		cy.route({
			method,
			url: `${API_URL}${value}`,
		}).as(id)
		cy.wait('@' + id)
	} else if (property === 'pathname') {
		cy.route({
			method,
			url: `${API_URL}${value}**`,
		}).as(id)
		cy.wait('@' + id)
	} else {
		throw new Error(`Unexpected XHR property: ${property}`)
	}
}
