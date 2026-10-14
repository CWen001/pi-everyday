local wezterm = require 'wezterm'

return function(config, options)
  local resolver = options.resolver
  local node_program = options.node_program or 'node'

  wezterm.on('open-uri', function(window, _, uri)
    if uri:sub(1, 5):lower() ~= 'file:' then return end

    local ok, err = pcall(function()
      -- Read held modifiers before the resolver can delay activation.
      local modifiers = window:keyboard_modifiers()
      if type(modifiers) ~= 'string' then
        error('keyboard_modifiers returned no modifier string', 0)
      end
      local intent = 'target'
      for modifier in modifiers:gmatch('[^|]+') do
        if modifier == 'ALT' then intent = 'folder' end
      end
      local success, stdout, stderr = wezterm.run_child_process {
        node_program, resolver, uri, intent,
      }
      if not success then
        error('resolve-folder failed: ' .. stderr, 0)
      end
      local result = wezterm.json_parse(stdout)
      if type(result) ~= 'table' or type(result.path) ~= 'string' or result.path == '' then
        error('resolve-folder returned JSON without a nonempty path string', 0)
      end
      wezterm.open_with(result.path)
    end)
    if not ok then
      wezterm.log_error('path-links: ' .. tostring(err))
    end
    -- Never fall back to a different file action after a failure.
    return false
  end)

  local reserved = { CTRL = true, ALT = true }
  local modifiers = { 'CTRL', 'ALT' }
  if wezterm.target_triple:find('darwin', 1, true) then
    reserved.SUPER, reserved.CMD, reserved.WIN = true, true, true
    table.insert(modifiers, 'SUPER')
  end
  local bindings = {}
  for _, binding in ipairs(config.mouse_bindings or {}) do
    local click = binding.event and (binding.event.Down or binding.event.Up)
    if not (reserved[binding.mods] and click and click.button == 'Left' and click.streak == 1) then
      table.insert(bindings, binding)
    end
  end
  for _, mods in ipairs(modifiers) do
    for _, reporting in ipairs { false, true } do
      table.insert(bindings, {
        event = { Down = { streak = 1, button = 'Left' } },
        mods = mods,
        action = wezterm.action.Nop,
        mouse_reporting = reporting,
      })
      table.insert(bindings, {
        event = { Up = { streak = 1, button = 'Left' } },
        mods = mods,
        action = wezterm.action.OpenLinkAtMouseCursor,
        mouse_reporting = reporting,
      })
    end
  end
  config.mouse_bindings = bindings
end
