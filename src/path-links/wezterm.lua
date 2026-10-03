local wezterm = require 'wezterm'

return function(config, options)
  local resolver = options.resolver
  local node_program = options.node_program or 'node'

  wezterm.on('open-uri', function(_, _, uri)
    if uri:sub(1, 5):lower() ~= 'file:' then return end

    local ok, err = pcall(function()
      local success, stdout, stderr = wezterm.run_child_process {
        node_program, resolver, uri,
      }
      if not success then
        error('resolve-folder failed: ' .. stderr, 0)
      end
      local result = wezterm.json_parse(stdout)
      if type(result) ~= 'table' or type(result.folder) ~= 'string' or result.folder == '' then
        error('resolve-folder returned JSON without a nonempty folder string', 0)
      end
      wezterm.open_with(result.folder)
    end)
    if not ok then
      wezterm.log_error('path-links: ' .. tostring(err))
    end
    -- File links always follow the directory policy, including failures.
    return false
  end)

  local mods = wezterm.target_triple:find('darwin', 1, true) and 'SUPER' or 'CTRL'
  local bindings = {}
  for _, binding in ipairs(config.mouse_bindings or {}) do
    local click = binding.event and (binding.event.Down or binding.event.Up)
    local same_mods = binding.mods == mods
      or (mods == 'SUPER' and (binding.mods == 'CMD' or binding.mods == 'WIN'))
    if not (same_mods and click and click.button == 'Left' and click.streak == 1) then
      table.insert(bindings, binding)
    end
  end
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
  config.mouse_bindings = bindings
end
