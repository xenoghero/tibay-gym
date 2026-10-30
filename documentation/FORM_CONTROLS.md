# Shared dropdowns and dates

- Use `FormSelect` from `components/ui/form-select.tsx` for standard dropdowns. It accepts native select props and option children, including labels, required validation, disabled options, names and change handlers.
- Use `StyledSelect` for richer choices with a mark and description, such as payment accounts. It shares the same option surface and popup positioning as `FormSelect`.
- Use `FormInput` for inputs. Dates and local datetimes automatically use the shared calendar; existing ISO values, typed entry, refs and native validation remain available. Datetimes keep a separate time field in the calendar.
- Popup colors, borders and selected states use the existing `--rs-*` tokens. Calendar styling lives in `field-controls.module.css`; shared field styling lives in `app/globals.css`.
- `FieldPopover` uses the browser top layer and viewport positioning. It stays inside any containing dialog so mobile sheets retain interactive controls. Nested month/year menus remain inside their calendar.

Dropdown keys: arrows, Home, End, Enter, Space, type-ahead, Escape and Tab. Dates open with a click or Alt+Down; calendar days support arrow navigation and Escape returns focus to the field.

Regression coverage is in `components/ui/field-controls.dom.test.tsx`, `components/ui/form-input.dom.test.tsx`, and `components/payments/payment-method-select.dom.test.tsx`.
