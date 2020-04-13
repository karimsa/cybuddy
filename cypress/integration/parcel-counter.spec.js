describe('<Counter /> with parcel', () => {
	it('should be able to stop working test', () => {
		cy.contains('CyBuddy').should('not.exist')
		cy.visit('http://localhost:1234/?testMode=true&async=true')
		cy.contains('CyBuddy')
		cy.contains('Create new test from login').click()
		cy.contains('Run steps')

		// Creating lots of steps, so the test takes time to finish
		for (let i = 0; i < 10; i++) {
			cy.simulateOverlayClick('[data-test="btn-increase"]')
			cy.contains('Add step').click()

			cy.simulateOverlayClick('[data-test="btn-increase"]')
			cy.get('[data-test="input-selector"]')
				.clear()
				.type(`Counter: ${i + 1}`)
			cy.get('[data-test="checkbox-use-selector"]').click()
			cy.get('[data-test="input-action"]').select('exist')
			cy.contains('Add step').click()
		}

		// Start the run, and force it to halt
		cy.contains('Run steps').click()
		cy.get('.alert-danger').should('not.exist')
		cy.wait(500)
		cy.contains('Stop').click()
		cy.wait(1000)
		cy.contains('Run steps').should('exist')
		cy.contains('Counter: 10').should('not.exist')
	})

	it('should be able to stop broken test', () => {
		cy.contains('CyBuddy').should('not.exist')
		cy.visit('http://localhost:1234/?testMode=true')
		cy.contains('CyBuddy')
		cy.contains('Create new empty test').click()
		cy.contains('Run steps')

		// Create a step for an element that doesn't exist
		cy.simulateOverlayClick('[data-test="btn-increase"]')
		cy.get('[data-test="input-selector"]')
			.clear()
			.type('[data-test="btn-not-exist"]')
		cy.contains('Add step').click()

		// Start the run, which should be fail
		cy.contains('Run steps').click()
		cy.get('.alert-danger').should('exist')

		// Start the run, error should be removed
		cy.contains('Run steps').click()
		cy.get('.alert-danger').should('not.exist')
		cy.wait(1000)
		cy.contains('Stop').click()
		cy.wait(1000)
		cy.contains('Run steps').should('exist')
	})

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
