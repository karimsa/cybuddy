import $ from 'jquery'
import React, { createRef } from 'react'
import PropTypes from 'prop-types'

export function Alert({ children, type, dismissable, className = '' }) {
	const ref = createRef()

	if (dismissable) {
		return (
			<div
				ref={ref}
				className={`alert alert-${type} alert-dismissable mb-0 ${className}`}
				role="alert"
			>
				{children}
				<button
					type="button"
					className="close"
					data-dismiss="alert"
					aria-label="Close"
					onClick={() => $(ref.current).fadeOut()}
				>
					<span aria-hidden="true">&times;</span>
				</button>
			</div>
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
}
