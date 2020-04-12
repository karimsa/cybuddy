const puppeteer = require('puppeteer')

test('Counter', async () => {
	const browser = await puppeteer.launch({
		headless: false,
	})
	const [page] = await browser.pages()
	await page.goto('http://localhost:1234')
	await page.evaluate(() => {
		const event = new MouseEvent('click', {
			pageX: 0,
			pageY: 0,
		})
		document.querySelector('[data-test="pointer-overlay"]').dispatchEvent(event)
	})
	await page.close()
})
