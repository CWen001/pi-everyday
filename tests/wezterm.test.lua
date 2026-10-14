local original_wezterm = package.loaded.wezterm
local uri = 'file:///研究%20%2520%23.v1/LICENSE'

for _, platform in ipairs { 'aarch64-apple-darwin', 'x86_64-pc-windows-msvc' } do
  local handler
  local calls, opened, errors
  local response, child_success, modifier_value, modifier_error, child_error, parse_error, open_error
  local fake = {
    target_triple = platform,
    action = { Nop = 'nop', OpenLinkAtMouseCursor = 'open-link' },
    on = function(event, callback)
      assert(event == 'open-uri')
      handler = callback
    end,
    run_child_process = function(argv)
      table.insert(calls, 'resolve')
      assert(#argv == 4)
      assert(argv[1] == '/node with spaces')
      assert(argv[2] == '/resolver with spaces.mjs')
      assert(argv[3] == uri)
      assert(argv[4] == 'target' or argv[4] == 'folder')
      calls.intent = argv[4]
      if child_error then error('child failed') end
      return child_success, 'json', 'resolver error'
    end,
    json_parse = function(text)
      assert(text == 'json')
      if parse_error then error('invalid JSON') end
      return response
    end,
    open_with = function(path)
      table.insert(calls, 'open')
      if open_error then error('open failed') end
      table.insert(opened, path)
    end,
    log_error = function(message) table.insert(errors, message) end,
  }
  package.loaded.wezterm = fake
  local apply = dofile('src/path-links/wezterm.lua')
  local retained = {
    { mods = 'NONE', event = { Down = { streak = 1, button = 'Left' } }, action = 'select' },
    { mods = 'NONE', event = { Up = { streak = 1, button = 'Left' } }, action = 'selection-end' },
    { mods = 'CTRL', event = { Drag = { streak = 1, button = 'Left' } }, action = 'drag' },
    { mods = 'ALT', event = { Up = { streak = 2, button = 'Left' } }, action = 'double' },
    { mods = 'CTRL', event = { Up = { streak = 1, button = 'Right' } }, action = 'right' },
    { mods = 'SHIFT', event = { Up = { streak = 1, button = 'Left' } }, action = 'shift' },
  }
  local config = { mouse_bindings = {} }
  for _, binding in ipairs(retained) do table.insert(config.mouse_bindings, binding) end
  for _, mods in ipairs { 'CTRL', 'ALT', 'SUPER', 'CMD', 'WIN' } do
    table.insert(config.mouse_bindings, {
      mods = mods, event = { Up = { streak = 1, button = 'Left' } }, action = 'old',
    })
  end
  apply(config, { node_program = '/node with spaces', resolver = '/resolver with spaces.mjs' })
  for i, binding in ipairs(retained) do assert(config.mouse_bindings[i] == binding) end
  local mac = platform:find('darwin', 1, true) ~= nil
  local counts = {}
  for _, binding in ipairs(config.mouse_bindings) do
    if binding.action == 'nop' or binding.action == 'open-link' then
      assert(binding.mods == 'CTRL' or binding.mods == 'ALT' or (mac and binding.mods == 'SUPER'))
      local event = binding.event.Down and 'Down' or 'Up'
      assert(binding.action == (event == 'Down' and 'nop' or 'open-link'))
      local key = binding.mods .. '/' .. event .. '/' .. tostring(binding.mouse_reporting)
      assert(not counts[key], 'duplicate mouse binding')
      counts[key] = true
    elseif binding.action == 'old' then
      assert(not mac and (binding.mods == 'SUPER' or binding.mods == 'CMD' or binding.mods == 'WIN'))
    end
  end
  assert(#config.mouse_bindings == #retained + (mac and 12 or 11))
  for _, mods in ipairs(mac and { 'CTRL', 'ALT', 'SUPER' } or { 'CTRL', 'ALT' }) do
    for _, reporting in ipairs { false, true } do
      for _, event in ipairs { 'Down', 'Up' } do
        assert(counts[mods .. '/' .. event .. '/' .. tostring(reporting)])
      end
    end
  end

  local window = { keyboard_modifiers = function()
    table.insert(calls, 'modifiers')
    if modifier_error then error('modifiers unavailable') end
    return modifier_value
  end }
  local function reset(mods)
    calls, opened, errors = {}, {}, {}
    modifier_value = mods
    response = { path = '/resolved 研究 %20#' }
    child_success = true
    modifier_error, child_error, parse_error, open_error = false, false, false, false
  end

  for _, mods in ipairs { 'ALT', 'ALT|LEFT_ALT', 'CTRL|ALT|LEFT_ALT', 'NONE', 'CTRL', 'SUPER', 'LEFT_ALT', 'NOT_ALT' } do
    reset(mods)
    assert(handler(window, {}, uri) == false)
    local folder = mods == 'ALT' or mods == 'ALT|LEFT_ALT' or mods == 'CTRL|ALT|LEFT_ALT'
    assert(calls.intent == (folder and 'folder' or 'target'))
    assert(table.concat(calls, ',') == 'modifiers,resolve,open')
    assert(#opened == 1 and opened[1] == response.path)
    assert(#errors == 0)
  end
  reset('ALT')
  assert(handler(window, {}, 'https://example.com') == nil)
  assert(#calls == 0 and #opened == 0 and #errors == 0)

  for _, failure in ipairs { 'modifiers', 'modifier-type', 'child', 'child-exception', 'json', 'path', 'empty-path', 'old-folder', 'lua-open' } do
    reset('ALT')
    if failure == 'modifiers' then modifier_error = true
    elseif failure == 'modifier-type' then modifier_value = nil
    elseif failure == 'child' then child_success = false
    elseif failure == 'child-exception' then child_error = true
    elseif failure == 'json' then parse_error = true
    elseif failure == 'path' then response = { path = 42 }
    elseif failure == 'empty-path' then response = { path = '' }
    elseif failure == 'old-folder' then response = { folder = '/old' }
    elseif failure == 'lua-open' then open_error = true end
    assert(handler(window, {}, uri) == false)
    assert(#opened == 0 and #errors == 1, failure)
    if failure == 'modifiers' or failure == 'modifier-type' then assert(#calls == 1) end
    reset('CTRL')
    assert(handler(window, {}, uri) == false)
    assert(calls.intent == 'target' and #opened == 1 and #errors == 0)
  end
end

package.loaded.wezterm = original_wezterm
io.write('wezterm path-links checks passed\n')
return {}
