import each from 'licia/each'
import isStr from 'licia/isStr'
import startWith from 'licia/startWith'
import truncate from 'licia/truncate'
import LunaModal from 'luna-modal'
import LunaDataGrid from 'luna-data-grid'
import isNull from 'licia/isNull'
import trim from 'licia/trim'
import copy from 'licia/copy'
import emitter from '../lib/emitter'
import { openEditor, getEditorContainer } from '../lib/editorModal'
import { safeStorage, classPrefix as c } from '../lib/util'

export default class Storage {
  constructor($container, devtools, resources, type) {
    this._type = type
    this._$container = $container
    this._devtools = devtools
    this._resources = resources
    this._selectedItem = null
    this._storeData = []
    // Original value of every key seen since the panel was opened. Kept across
    // refreshes so "Restore" always writes back the value from before editing.
    this._originalData = {}

    this._initTpl()
    this._dataGrid = new LunaDataGrid(this._$dataGrid.get(0), {
      columns: [
        {
          id: 'key',
          title: 'Key',
          weight: 30,
        },
        {
          id: 'value',
          title: 'Value',
          weight: 90,
        },
      ],
      minHeight: 60,
      maxHeight: 223,
    })

    this._bindEvent()
  }
  destroy() {
    emitter.off(emitter.SCALE, this._updateGridHeight)
  }
  refresh() {
    const dataGrid = this._dataGrid

    this._refreshStorage()
    dataGrid.clear()

    each(this._storeData, ({ key, val }) => {
      dataGrid.append(
        {
          key,
          value: val,
        },
        {
          selectable: true,
        }
      )
    })
  }
  _refreshStorage() {
    const resources = this._resources

    let store = safeStorage(this._type, false)

    if (!store) return

    const storeData = []

    // Mobile safari is not able to loop through localStorage directly.
    store = JSON.parse(JSON.stringify(store))

    each(store, (val, key) => {
      // According to issue 20, not all values are guaranteed to be string.
      if (!isStr(val)) return

      if (resources.config.get('hideErudaSetting')) {
        if (startWith(key, 'eruda') || key === 'active-eruda') return
      }

      if (!Object.prototype.hasOwnProperty.call(this._originalData, key)) {
        this._originalData[key] = val
      }

      storeData.push({
        key: key,
        val: truncate(val, 200),
      })
    })

    this._storeData = storeData
  }
  _updateButtons() {
    const $container = this._$container
    const $showDetail = $container.find(c('.show-detail'))
    const $editStorage = $container.find(c('.edit-storage'))
    const $restoreStorage = $container.find(c('.restore-storage'))
    const $deleteStorage = $container.find(c('.delete-storage'))
    const $copyStorage = $container.find(c('.copy-storage'))
    const btnDisabled = c('btn-disabled')

    $showDetail.addClass(btnDisabled)
    $editStorage.addClass(btnDisabled)
    $restoreStorage.addClass(btnDisabled)
    $deleteStorage.addClass(btnDisabled)
    $copyStorage.addClass(btnDisabled)

    if (this._selectedItem) {
      $showDetail.rmClass(btnDisabled)
      $editStorage.rmClass(btnDisabled)
      $restoreStorage.rmClass(btnDisabled)
      $deleteStorage.rmClass(btnDisabled)
      $copyStorage.rmClass(btnDisabled)
    }
  }
  _initTpl() {
    const $container = this._$container
    const type = this._type

    $container.html(
      c(`<h2 class="title">
      ${type === 'local' ? 'Local' : 'Session'} Storage
    </h2>
    <div class="title-btns">
      <div class="btn refresh-storage">
        <span class="icon icon-refresh"></span>
      </div>
      <div class="btn restore-storage btn-disabled" title="Restore original value">
        <span class="icon icon-reset"></span>
      </div>
      <div class="btn edit-storage btn-disabled" title="Edit value">
        <span class="icon icon-select"></span>
      </div>
      <div class="btn show-detail btn-disabled">
        <span class="icon icon-eye"></span>
      </div>
      <div class="btn copy-storage btn-disabled">
        <span class="icon icon-copy"></span>
      </div>
      <div class="btn delete-storage btn-disabled">
        <span class="icon icon-delete"></span>
      </div>
      <div class="btn clear-storage">
        <span class="icon icon-clear"></span>
      </div>
      <div class="btn filter">
        <span class="icon icon-filter"></span>
      </div>
      <div class="btn filter-text"></div>
    </div>
    <div class="data-grid"></div>`)
    )

    this._$dataGrid = $container.find(c('.data-grid'))
    this._$filterText = $container.find(c('.filter-text'))
  }
  _getVal(key) {
    return this._type === 'local'
      ? localStorage.getItem(key)
      : sessionStorage.getItem(key)
  }
  _setVal(key, val) {
    if (this._type === 'local') {
      localStorage.setItem(key, val)
    } else {
      sessionStorage.setItem(key, val)
    }
  }
  _openEditor() {
    const key = this._selectedItem
    if (!key) return

    const devtools = this._devtools
    openEditor({
      container: getEditorContainer(devtools),
      title: 'Edit ' + key,
      value: this._getVal(key) || '',
      saveText: 'Save',
      hint: 'Edit the value, then press Save or Ctrl/Cmd + Enter.',
      format: 'json',
      drawer: true,
      onSave: (val) => {
        this._setVal(key, val)
        devtools.notify('Saved', { icon: 'success' })
        this.refresh()
      },
    })
  }
  _restoreOriginal() {
    const key = this._selectedItem
    if (!key || !Object.prototype.hasOwnProperty.call(this._originalData, key))
      return

    this._setVal(key, this._originalData[key])
    this._devtools.notify('Restored', { icon: 'success' })
    this.refresh()
  }
  _updateGridHeight = (scale) => {
    this._dataGrid.setOption({
      minHeight: 60 * scale,
      maxHeight: 223 * scale,
    })
  }
  _bindEvent() {
    const type = this._type
    const devtools = this._devtools

    this._$container
      .on('click', c('.refresh-storage'), () => {
        devtools.notify('Refreshed', { icon: 'success' })
        this.refresh()
      })
      .on('click', c('.clear-storage'), () => {
        each(this._storeData, (val) => {
          if (type === 'local') {
            localStorage.removeItem(val.key)
          } else {
            sessionStorage.removeItem(val.key)
          }
        })
        this.refresh()
      })
      .on('click', c('.edit-storage'), () => this._openEditor())
      .on('click', c('.restore-storage'), () => this._restoreOriginal())
      .on('click', c('.show-detail'), () => {
        const key = this._selectedItem
        const val = this._getVal(key)

        try {
          showSources('object', JSON.parse(val))
        } catch {
          showSources('raw', val)
        }
      })
      .on('click', c('.copy-storage'), () => {
        const key = this._selectedItem
        copy(this._getVal(key))
        devtools.notify('Copied', { icon: 'success' })
      })
      .on('click', c('.filter'), () => {
        LunaModal.prompt('Filter').then((filter) => {
          if (isNull(filter)) return
          filter = trim(filter)
          this._$filterText.text(filter)
          this._dataGrid.setOption('filter', filter)
        })
      })
      .on('click', c('.delete-storage'), () => {
        const key = this._selectedItem

        if (type === 'local') {
          localStorage.removeItem(key)
        } else {
          sessionStorage.removeItem(key)
        }

        this.refresh()
      })

    function showSources(type, data) {
      const sources = devtools.get('sources')
      if (!sources) return

      sources.set(type, data)

      devtools.showTool('sources')

      return true
    }

    this._dataGrid
      .on('select', (node) => {
        this._selectedItem = node.data.key
        this._updateButtons()
      })
      .on('deselect', () => {
        this._selectedItem = null
        this._updateButtons()
      })

    emitter.on(emitter.SCALE, this._updateGridHeight)
  }
}
