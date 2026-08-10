/**
 * Mobile keyboard accessory bar.
 *
 * When any input (including the xterm terminal helper textarea) is focused on
 * a touch device, the Android system soft keyboard appears. This component
 * renders a fixed toolbar above the keyboard with extra control keys that are
 * hard or impossible to type on a mobile keyboard:
 *
 *   ESC, Tab, Ctrl (toggle), Alt (toggle), arrow keys, Ctrl-C, Ctrl-D,
 *   Ctrl-Z, Ctrl-L, Ctrl-R, Ctrl-A, Ctrl-E, Ctrl-W, Ctrl-U, Ctrl-K,
 *   Home, End, PgUp, PgDn, /, :, -, `, \, Backspace, and a "Done" button
 *   to dismiss the keyboard.
 *
 * For the terminal:
 *   - Keys are sent directly to the active terminal's AttachAddon._sendData,
 *     bypassing xterm's textarea entirely (reliable, no focus-juggling).
 *   - The Ctrl toggle wraps _sendData so the NEXT character typed on the soft
 *     keyboard is converted to Ctrl+char, then auto-disables. This lets you
 *     type Ctrl+any letter, not just the pre-defined shortcuts.
 *   - The Alt toggle sends an ESC prefix (\x1b) before the next character.
 *
 * For regular <input>/<textarea>:
 *   - Special keys (Tab, arrows, Home, End, Backspace, Enter) are dispatched
 *     as KeyboardEvent so the focused element / React handler can react.
 *   - Character keys (/, :, -, `, \) are inserted at the cursor via
 *     document.execCommand('insertText').
 *   - Ctrl-C / Ctrl-D etc. are no-ops for regular inputs (they are terminal
 *     only) but are still shown so the bar layout is consistent.
 */

import { Component } from 'react'
import './keyboard-accessory-bar.styl'

// Terminal escape sequences
const ESC = '\x1b'
const sequences = {
  esc: ESC,
  tab: '\t',
  enter: '\r',
  backspace: '\x7f', // DEL (what xterm sends for Backspace)
  up: ESC + '[A',
  down: ESC + '[B',
  right: ESC + '[C',
  left: ESC + '[D',
  home: ESC + '[H',
  end: ESC + '[F',
  pageup: ESC + '[5~',
  pagedown: ESC + '[6~',
  // Ctrl+letter = char code 1..26
  ctrlC: '\x03',
  ctrlD: '\x04',
  ctrlZ: '\x1a',
  ctrlL: '\x0c',
  ctrlR: '\x12',
  ctrlA: '\x01',
  ctrlE: '\x05',
  ctrlW: '\x17',
  ctrlU: '\x15',
  ctrlK: '\x0b'
}

// Keys that apply to regular inputs too (dispatched as KeyboardEvent)
const keyboardEventMap = {
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 }
}

// Character-insert keys for regular inputs
const charKeys = {
  slash: '/',
  colon: ':',
  minus: '-',
  backtick: '`',
  backslash: '\\'
}

// Button layout. Each entry: { id, label, type }
// type: 'seq' = terminal sequence, 'char' = insert character,
//       'toggle' = modifier toggle, 'done' = dismiss keyboard,
//       'hide' = collapse the bar (keep the keyboard)
//
// NOTE: the 'hide' button is intentionally NOT in this list. It is rendered
// outside the scroll container (see render()) so it stays pinned to the left
// even when the user scrolls the key row all the way to the end.
const buttonLayout = [
  { id: 'esc', label: 'ESC', type: 'seq' },
  { id: 'tab', label: 'TAB', type: 'seq' },
  { id: 'ctrl', label: 'CTRL', type: 'toggle' },
  { id: 'alt', label: 'ALT', type: 'toggle' },
  { id: 'up', label: '↑', type: 'seq' },
  { id: 'down', label: '↓', type: 'seq' },
  { id: 'left', label: '←', type: 'seq' },
  { id: 'right', label: '→', type: 'seq' },
  { id: 'ctrlC', label: 'Ctrl-C', type: 'seq' },
  { id: 'ctrlD', label: 'Ctrl-D', type: 'seq' },
  { id: 'ctrlZ', label: 'Ctrl-Z', type: 'seq' },
  { id: 'ctrlL', label: 'Ctrl-L', type: 'seq' },
  { id: 'ctrlR', label: 'Ctrl-R', type: 'seq' },
  { id: 'ctrlA', label: 'Ctrl-A', type: 'seq' },
  { id: 'ctrlE', label: 'Ctrl-E', type: 'seq' },
  { id: 'ctrlW', label: 'Ctrl-W', type: 'seq' },
  { id: 'ctrlU', label: 'Ctrl-U', type: 'seq' },
  { id: 'ctrlK', label: 'Ctrl-K', type: 'seq' },
  { id: 'home', label: 'Home', type: 'seq' },
  { id: 'end', label: 'End', type: 'seq' },
  { id: 'pageup', label: 'PgUp', type: 'seq' },
  { id: 'pagedown', label: 'PgDn', type: 'seq' },
  { id: 'slash', label: '/', type: 'char' },
  { id: 'colon', label: ':', type: 'char' },
  { id: 'minus', label: '-', type: 'char' },
  { id: 'backtick', label: '`', type: 'char' },
  { id: 'backslash', label: '\\', type: 'char' },
  { id: 'backspace', label: '⌫', type: 'seq' },
  { id: 'enter', label: '↵', type: 'seq' },
  { id: 'done', label: 'Done', type: 'done' }
]

export default class KeyboardAccessoryBar extends Component {
  constructor (props) {
    super(props)
    this.state = {
      visible: false,
      hidden: false,
      isTerminal: false,
      ctrlActive: false,
      altActive: false
    }
    this._focusTimer = null
    this._wrappedAddon = null
    this._originalSendData = null
  }

  componentDidMount () {
    // Use focusin/focusout (bubbling) to detect when any input is focused.
    document.addEventListener('focusin', this.handleFocusIn, true)
    document.addEventListener('focusout', this.handleFocusOut, true)
    this._syncBarHeight()
  }

  componentDidUpdate () {
    this._syncBarHeight()
  }

  componentWillUnmount () {
    document.removeEventListener('focusin', this.handleFocusIn, true)
    document.removeEventListener('focusout', this.handleFocusOut, true)
    clearTimeout(this._focusTimer)
    this._restoreSendData()
    // Give the reserved space back.
    document.documentElement.style.setProperty('--kb-bar-h', '0px')
  }

  /**
   * Publish the bar's height as --kb-bar-h on :root so the page can reserve
   * that much space at the bottom and the bar never covers content (see the
   * matching rules in keyboard-accessory-bar.styl). 0 when hidden/collapsed.
   */
  _syncBarHeight = () => {
    const h = (this.state.visible && !this.state.hidden && this._barEl)
      ? this._barEl.offsetHeight
      : 0
    document.documentElement.style.setProperty('--kb-bar-h', h + 'px')
  }

  handleFocusIn = (e) => {
    const el = e.target
    if (!el) return
    const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    if (!isInput) return
    // Skip readonly inputs (like the batch-input holder) — they don't need
    // the keyboard and showing the bar would be confusing.
    if (el.readOnly || el.disabled) return
    const isTerminal = el.classList?.contains('xterm-helper-textarea')
    clearTimeout(this._focusTimer)
    // Small delay so focusout→focusin rapid switching (e.g. tapping a bar
    // button) doesn't cause a hide→show flicker.
    this._focusTimer = setTimeout(() => {
      this.setState({ visible: true, hidden: false, isTerminal })
    }, 50)
  }

  handleFocusOut = () => {
    clearTimeout(this._focusTimer)
    // Delay hiding so that tapping a bar button (which steals focus) doesn't
    // immediately hide the bar before the button's onClick fires.
    this._focusTimer = setTimeout(() => {
      const active = document.activeElement
      const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')
      if (!isInput) {
        this.setState({
          visible: false,
          hidden: false,
          ctrlActive: false,
          altActive: false
        })
        this._restoreSendData()
      }
    }, 200)
  }

  /**
   * Get the active terminal's AttachAddon so we can send data directly.
   * Uses window.refs (global) which is set up by electerm-react's ref module.
   */
  getAttachAddon () {
    const store = window.store
    if (!store?.activeTabId) return null
    const term = window.refs?.get('term-' + store.activeTabId)
    return term?.attachAddon ?? null
  }

  /**
   * Send a terminal escape sequence to the active terminal.
   */
  sendToTerminal (seq) {
    const addon = this.getAttachAddon()
    if (addon?._sendData) {
      addon._sendData(seq)
    }
  }

  /**
   * Ctrl toggle: wrap _sendData so the NEXT character typed on the soft
   * keyboard is converted to Ctrl+char, then auto-restores.
   */
  enableCtrlMode () {
    const addon = this.getAttachAddon()
    if (!addon?._sendData) return
    this._restoreSendData()
    this._originalSendData = addon._sendData
    this._wrappedAddon = addon
    const original = this._originalSendData
    const self = this
    addon._sendData = function (data) {
      if (typeof data === 'string' && data.length === 1) {
        const code = data.charCodeAt(0)
        let ctrlCode = -1
        if (code >= 97 && code <= 122) ctrlCode = code - 96 // a-z → 1-26
        else if (code >= 65 && code <= 90) ctrlCode = code - 64 // A-Z → 1-26
        if (ctrlCode >= 1 && ctrlCode <= 26) {
          data = String.fromCharCode(ctrlCode)
        }
      }
      // Restore immediately — Ctrl applies to one keystroke only.
      self._clearWrapper()
      original.call(addon, data)
    }
  }

  /**
   * Alt toggle: send ESC prefix before the next character.
   */
  enableAltMode () {
    const addon = this.getAttachAddon()
    if (!addon?._sendData) return
    this._restoreSendData()
    this._originalSendData = addon._sendData
    this._wrappedAddon = addon
    const original = this._originalSendData
    const self = this
    addon._sendData = function (data) {
      if (typeof data === 'string' && data.length === 1) {
        data = ESC + data
      }
      self._clearWrapper()
      original.call(addon, data)
    }
  }

  /**
   * Clear the wrapper state without restoring (used by the wrapper itself
   * after it has already called the original).
   */
  _clearWrapper () {
    this._wrappedAddon = null
    this._originalSendData = null
  }

  /**
   * Restore the original _sendData (remove Ctrl/Alt wrapper).
   */
  _restoreSendData () {
    if (this._wrappedAddon && this._originalSendData) {
      this._wrappedAddon._sendData = this._originalSendData
      this._wrappedAddon = null
      this._originalSendData = null
    }
  }

  /**
   * Dispatch a KeyboardEvent on the focused element (for regular inputs).
   */
  dispatchKeyEvent (id) {
    const map = keyboardEventMap[id]
    if (!map) return
    const el = document.activeElement
    if (!el) return
    const opts = {
      key: map.key,
      code: map.code,
      keyCode: map.keyCode,
      bubbles: true,
      cancelable: true
    }
    el.dispatchEvent(new window.KeyboardEvent('keydown', opts))
    el.dispatchEvent(new window.KeyboardEvent('keyup', opts))
  }

  /**
   * Insert a character at the cursor in a regular input/textarea.
   */
  insertChar (ch) {
    const el = document.activeElement
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return
    if (el.readOnly || el.disabled) return
    el.focus()
    try {
      document.execCommand('insertText', false, ch)
    } catch (e) {
      // Fallback: manual insertion
      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? 0
      const val = el.value
      el.value = val.slice(0, start) + ch + val.slice(end)
      el.setSelectionRange(start + ch.length, start + ch.length)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  handleButton = (btn, ev) => {
    // Prevent the tap from stealing focus from the terminal/input.
    ev.preventDefault()
    ev.stopPropagation()

    const { isTerminal } = this.state

    switch (btn.type) {
      case 'hide': {
        // Collapse the bar but keep the keyboard open so the user can still
        // type. A floating button (rendered in render()) brings it back.
        this.setState({ hidden: true, ctrlActive: false, altActive: false })
        this._restoreSendData()
        break
      }
      case 'done': {
        // Dismiss the keyboard by blurring the focused element.
        const el = document.activeElement
        if (el && el.blur) el.blur()
        this.setState({ visible: false, hidden: false, ctrlActive: false, altActive: false })
        this._restoreSendData()
        break
      }
      case 'toggle': {
        if (btn.id === 'ctrl') {
          const willActive = !this.state.ctrlActive
          // If alt was on, turn it off
          if (willActive && this.state.altActive) {
            this._restoreSendData()
            this.setState({ altActive: false })
          }
          this.setState({ ctrlActive: willActive })
          if (willActive) {
            this.enableCtrlMode()
          } else {
            this._restoreSendData()
          }
        } else if (btn.id === 'alt') {
          const willActive = !this.state.altActive
          if (willActive && this.state.ctrlActive) {
            this._restoreSendData()
            this.setState({ ctrlActive: false })
          }
          this.setState({ altActive: willActive })
          if (willActive) {
            this.enableAltMode()
          } else {
            this._restoreSendData()
          }
        }
        break
      }
      case 'seq': {
        if (isTerminal) {
          this.sendToTerminal(sequences[btn.id])
        } else {
          this.dispatchKeyEvent(btn.id)
        }
        break
      }
      case 'char': {
        const ch = charKeys[btn.id]
        if (isTerminal) {
          this.sendToTerminal(ch)
        } else {
          this.insertChar(ch)
        }
        break
      }
    }
  }

  renderButton (btn) {
    const { ctrlActive, altActive } = this.state
    let cls = 'kb-key'
    if (btn.type === 'toggle') {
      const active = btn.id === 'ctrl' ? ctrlActive : altActive
      cls += active ? ' kb-key-active' : ''
    }
    if (btn.id === 'hide') cls += ' kb-key-hide'
    if (btn.id === 'done') cls += ' kb-key-done'
    if (btn.id === 'backspace') cls += ' kb-key-wide'
    if (btn.id === 'enter') cls += ' kb-key-enter'
    return (
      <button
        key={btn.id}
        className={cls}
        // Use onMouseDown + preventDefault to keep focus on the terminal/input.
        onMouseDown={(e) => e.preventDefault()}
        onTouchStart={(e) => e.preventDefault()}
        onClick={(e) => this.handleButton(btn, e)}
        type='button'
      >
        {btn.label}
      </button>
    )
  }

  render () {
    const { visible, hidden } = this.state
    if (!visible) return null
    // Collapsed: render just a small floating button to bring the bar back.
    // The keyboard stays open; only the bar is hidden.
    if (hidden) {
      return (
        <button
          className='kb-accessory-show'
          aria-label='Show keyboard toolbar'
          // Keep focus on the terminal/input underneath.
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
          onClick={() => this.setState({ hidden: false })}
          type='button'
        >
          ▴
        </button>
      )
    }
    const { isTerminal } = this.state
    return (
      <div
        className='kb-accessory-bar'
        ref={(el) => { this._barEl = el }}
      >
        <div className='kb-accessory-row'>
          {/* Pinned hide button — always visible at the left, never scrolls. */}
          <button
            className='kb-key kb-key-hide'
            aria-label='Hide keyboard toolbar'
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onClick={(e) => this.handleButton({ id: 'hide', type: 'hide' }, e)}
            type='button'
          >
            ▾
          </button>
          <div className='kb-accessory-scroll'>
            {buttonLayout.map(btn => this.renderButton(btn))}
          </div>
        </div>
        {!isTerminal && (
          <div className='kb-accessory-hint'>
            Terminal keys active when terminal is focused
          </div>
        )}
      </div>
    )
  }
}
