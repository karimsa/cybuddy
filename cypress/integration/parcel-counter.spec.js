describe('<Counter /> with parcel', () => {
	it('should generate tests with clicks', () => {
		cy.visit('http://localhost:1234')
		cy.contains('Counter: 0')
		cy.get('[data-test="btn-increase"]').click()
		cy.get('[data-test="btn-increase"]').click()
		cy.get('[data-test="btn-increase"]').click()
		cy.contains('Counter: 3')
		cy.get('[data-test="btn-decrease"]').click()
		cy.get('[data-test="btn-decrease"]').click()
		cy.get('[data-test="btn-decrease"]').click()
		cy.get('[data-test="btn-decrease"]').click()
		cy.contains('Counter: -1')

		cy.contains('CyBuddy').should('not.exist')
		cy.visit('http://localhost:1234/?testMode=true')
		cy.contains('CyBuddy')
		cy.contains('Create new empty test').click()
		cy.contains('Run steps')

		for (let i = 0; i < 3; i++) {
			cy.simulateOverlayClick('[data-test="btn-increase"]')

			// Verify that the application did not catch the click
			cy.iframe().contains(`Counter: ${i}`)

			// Verify that CyBuddy caught all the right info
			cy.get('[data-test="input-selector"]').should(
				'have.value',
				'[data-test="btn-increase"]',
			)
			cy.get('[data-test="input-action"]').should('have.value', 'click')
			cy.contains('Delete step').should('not.exist')
			cy.contains('Add step').click()

			// Verify that clicks are running after the step is added
			cy.iframe().contains(`Counter: ${i + 1}`)
		}

		// Empty tests don't perform envReset, so the state
		// will not reset before doing more clicks
		cy.contains('Run steps').click()
		cy.wait(500)
		cy.iframe().contains(`Counter: 6`)

		cy.saveAndRunTest()
	})
})
