import React, { createRef, useEffect, useState } from 'react'
import PropTypes from 'prop-types'

export function Alert({
	children,
	type,
	dismissable,
	onDismiss,
	className = '',
}) {
	const ref = createRef()
	const [visible, setVisible] = useState(true)

	useEffect(() => {
		if (!visible) {
			setVisible(true)
		}
	}, [children])
	useEffect(() => {
		if (!visible) {
			onDismiss()
		}
	}, [visible])

	if (dismissable) {
		return (
			visible && (
				<div
					ref={ref}
					className={`alert alert-${type} alert-dismissable mb-0 ${className}`}
					role="alert"
				>
					{children}
					<button
						type="button"
						className="close"
						aria-label="Close"
						onClick={() => setVisible(false)}
					>
						<span aria-hidden="true">&times;</span>
					</button>
				</div>
			)
		)
	}

	return (
		<div className={`alert alert-${type} mb-0 ${className}`} role="alert">
			{children}
		</div>
	)
}

Alert.propTypes = {
	type: PropTypes.oneOf(['danger', 'success', 'primary', 'warning']).isRequired,
	dismissable: PropTypes.bool,
	className: PropTypes.string,
	onDismiss: PropTypes.func,
}
