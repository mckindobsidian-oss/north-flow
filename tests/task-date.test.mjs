import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTaskDateInput, parseTaskDate, taskDateText } from "../react-app/src/lib/task-date.js";

test("task date input is capped and grouped as DD/MM/YYYY", () => {
  assert.equal(formatTaskDateInput("399999999999999"), "39/99/9999");
  assert.equal(formatTaskDateInput("01022026"), "01/02/2026");
});

test("only real complete task dates are accepted", () => {
  assert.equal(parseTaskDate("29/02/2024"), "2024-02-29");
  assert.equal(parseTaskDate("31/02/2024"), null);
  assert.equal(parseTaskDate("1/2/2024"), null);
  assert.equal(parseTaskDate(""), "");
  assert.equal(taskDateText("2026-10-20"), "20/10/2026");
});
