import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Autocomplete, Checkbox, ColorPicker, Combobox, CurrencyInput, DateInput, DatePicker,
  DateRangePicker, FieldDescription, FieldError, Fieldset, FileUpload, Form, FormActions,
  FormField, InputGroup, Label, MultiSelect, NumberInput, PasswordInput, PhoneInput,
  RadioButton, RadioGroup, Rating, SearchInput, Select, Slider, Stepper, TagInput,
  TextInput, Textarea, TimeInput, Toggle, URLInput, UnsavedChangesGuard
} from "../src/index.js";

const noop = () => undefined;
const options = [{ id: "one", label: "One" }, { id: "two", label: "Two" }];
const messages = { label: "Field", name: "field", description: "Description" };

describe("form component family", () => {
  it("renders the P7.3 family with semantic controls and stable roots", () => {
    const markup = renderToStaticMarkup(<Form label="Example" onSubmit={noop}>
      <Fieldset legend="Group"><FormField {...messages}><span>Control</span></FormField></Fieldset>
      <Label>Loose label</Label><FieldDescription>Description</FieldDescription><FieldError>Error</FieldError>
      <TextInput {...messages} value="" onChange={noop} /><Textarea {...messages} value="" onChange={noop} />
      <NumberInput {...messages} value={1} onChange={noop} /><PasswordInput {...messages} value="" onChange={noop} />
      <SearchInput {...messages} value="" onChange={noop} /><CurrencyInput {...messages} value="1.00" onChange={noop} />
      <PhoneInput {...messages} value="" onChange={noop} /><URLInput {...messages} value="" onChange={noop} />
      <Checkbox {...messages} label="Check" checked={false} onChange={noop} />
      <RadioButton {...messages} label="Radio" value="one" checked onChange={noop} />
      <RadioGroup {...messages} value="one" options={options} onChange={noop} /><Toggle {...messages} label="Toggle" checked onChange={noop} />
      <Select {...messages} value="one" options={options} onChange={noop} /><MultiSelect {...messages} value={["one"]} options={options} onChange={noop} />
      <Combobox {...messages} value="one" options={options} onChange={noop} /><Autocomplete {...messages} value="one" options={options} onChange={noop} />
      <TagInput {...messages} value={["one"]} onChange={noop} /><Slider {...messages} value={2} onChange={noop} />
      <Stepper {...messages} value={2} onChange={noop} /><Rating {...messages} value={3} onChange={noop} />
      <ColorPicker {...messages} value="#000000" onChange={noop} /><DateInput {...messages} value="2026-08-27" onChange={noop} />
      <DatePicker {...messages} value="2026-08-27" onChange={noop} /><DateRangePicker {...messages} start="2026-08-27" end="2026-08-28" onChange={noop} />
      <TimeInput {...messages} value="10:00" onChange={noop} /><FileUpload {...messages} onChange={noop} />
      <InputGroup label="Actions"><span>Group</span></InputGroup><FormActions><button>Save</button></FormActions><UnsavedChangesGuard dirty={false} />
    </Form>);
    for (const id of ["form", "fieldset", "form-field", "label", "field-description", "field-error", "text-input", "textarea", "number-input", "password-input", "search-input", "currency-input", "phone-input", "url-input", "checkbox", "radio-button", "radio-group", "toggle", "select", "multi-select", "combobox", "autocomplete", "tag-input", "slider", "stepper", "rating", "color-picker", "date-input", "date-picker", "date-range-picker", "time-input", "file-upload", "input-group", "form-actions"]) expect(markup).toContain(`data-k-nex-component="${id}"`);
    expect(markup).toContain("<form");
    expect(markup).toContain("<fieldset");
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('type="file"');
  });

  it("connects errors and descriptions without exposing implementation classes", () => {
    const markup = renderToStaticMarkup(<TextInput {...messages} value="" error="Required" onChange={noop} />);
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain("aria-describedby=");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("class=");
  });

  it("connects checkbox and both date-range controls to their rendered messages", () => {
    const checkbox = renderToStaticMarkup(<Checkbox {...messages} label="Check" checked={false} error="Required" onChange={noop} />);
    const range = renderToStaticMarkup(<DateRangePicker {...messages} start="2026-08-27" end="2026-08-28" error="Required" onChange={noop} />);
    const control = (markup: string, slot: string): string => markup.match(new RegExp(`<input[^>]*data-slot="${slot}"[^>]*>`))?.[0] ?? "";

    for (const [markup, slots] of [[checkbox, ["control"]], [range, ["start", "end"]]] as const) {
      expect(markup).toContain('data-state="invalid"');
      for (const slot of slots) {
        const rendered = control(markup, slot);
        expect(rendered).toContain('aria-invalid="true"');
        const described = rendered.match(/aria-describedby="([^"]+)"/)?.[1];
        expect(described).toBeDefined();
        for (const id of described!.split(" ")) expect(markup).toContain(`id="${id}"`);
      }
    }
  });
});
