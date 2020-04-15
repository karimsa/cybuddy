import { useState, useEffect } from 'react'
import useSWR from 'swr'
import axios from 'axios'

const kPromise = Symbol('kPromise')

export function useLocalState(name, defaultValue) {
	const [value, setState] = useState(() => {
		const cachedValue = localStorage.getItem(name)
		if (cachedValue == null) {
			return defaultValue
		}
		return JSON.parse(cachedValue)
	})
	return [
		value,
		(nextValue) => {
			if (nextValue == null) {
				localStorage.removeItem(name)
			} else {
				localStorage.setItem(name, JSON.stringify(nextValue))
			}
			setState(nextValue)
		},
	]
}

function objectReducer(actions, state, action) {
	if (typeof actions[action.type] !== 'function') {
		throw new Error(`Unknown action type: ${action.type}`)
	}
	return actions[action.type](state, action)
}

// like React.useReducer() - but does not care if reducer changes
export function useReducer(reducer, initialState) {
	if (typeof reducer === 'object') {
		return useReducer(objectReducer.bind(null, reducer), initialState)
	}

	const [state, setState] = useState(initialState)

	return [
		state,
		(action) => {
			setState((state) => {
				const nextState = reducer(state, action, reducer)
				if (nextState != null && 'then' in nextState) {
					nextState.then(setState)
					return state
				} else {
					return nextState
				}
			})
		},
	]
}

export function useAsync(fn, deps) {
	const [state, actions] = useAsyncAction(fn, deps)
	if (deps === undefined && state.status === 'idle') {
		actions.fetch()
	}
	return state
}

export function useAsyncAction(fn, deps) {
	const [asyncArgs, setAsyncArgs] = useState()
	const [state, dispatch] = useReducer(
		(state, action) => {
			switch (action.type) {
				case 'FETCH':
					if (state.status === 'inprogress') {
						throw new Error(
							`Cannot re-fetch async action that is already inprogress`,
						)
					}
					setAsyncArgs(action.args)
					return {
						status: 'inprogress',
						result: state.result,
						error: state.error,
					}

				case 'FORCE_FETCH':
					setAsyncArgs(action.args)
					return {
						status: 'inprogress',
						result: state.result,
						error: state.error,
					}

				case 'SET_RESULT':
					return {
						status: 'success',
						result: action.result,
					}

				case 'ERROR':
					return {
						status: 'error',
						error: action.error,
						result: state.result,
					}

				case 'CANCEL':
					const promise = state[kPromise]
					if (promise && promise.cancel) {
						promise.cancel()
					}
					return {
						status: 'canceled',
						result: state.result,
					}

				case 'RESET':
					return {
						status: 'idle',
						result: state.result,
					}

				default:
					throw new Error(
						`Unexpected action received by reducer: ${action.type}`,
					)
			}
		},
		{
			status: 'idle',
		},
	)
	useEffect(() => {
		if (asyncArgs) {
			let canceled = false
			const promise = Promise.resolve(fn(...asyncArgs))
			promise
				.then((result) => {
					if (!canceled) {
						dispatch({ type: 'SET_RESULT', result })
					}
				})
				.catch((error) => {
					if (!canceled) {
						dispatch({ type: 'ERROR', error })
					}
				})

			return () => {
				if (promise.cancel) {
					promise.cancel()
				}
				canceled = true
			}
		}
	}, [asyncArgs])
	if (deps) {
		useEffect(() => {
			if (state.status !== 'inprogress') {
				dispatch({ type: 'FETCH', args: deps })
				return () => dispatch({ type: 'CANCEL' })
			}
		}, deps)
	}

	return [
		state,
		{
			fetch: (...args) => dispatch({ type: 'FETCH', args }),
			forceFetch: (...args) => dispatch({ type: 'FORCE_FETCH', args }),
			forceSet: (result) => dispatch({ type: 'SET_RESULT', result }),
			reset: () => dispatch({ type: 'RESET' }),
			cancel: () => dispatch({ type: 'CANCEL' }),
		},
	]
}

export function useAsyncActions(handlers) {
	return useAsyncAction(function (action, ...args) {
		return handlers[action].apply(this, args)
	})
}

export function useAPI(path, options = {}) {
	return useSWR(
		path,
		async () => {
			const { data } = await axios.get(path)
			return data
		},
		{
			revalidateOnFocus: false,
			...options,
		},
	)
}
