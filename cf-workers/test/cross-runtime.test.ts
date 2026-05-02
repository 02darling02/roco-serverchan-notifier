import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { deliverySummary } from "../src/push-delivery";
import {
  providerRequiredFields,
  providerSecretFields,
} from "../src/provider-specs";
import { buildMerchantMarkdown } from "../src/rocom";
import type { DeliveryReport } from "../src/types";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../tests/fixtures/cross_runtime_cases.json", import.meta.url),
    "utf8"
  )
) as {
  provider_specs: Array<{
    type: string;
    secret_fields: string[];
    required_fields: string[];
  }>;
  price_markdown: {
    worker_processed: Parameters<typeof buildMerchantMarkdown>[0];
    expected_lines: string[];
  };
  delivery_summary: {
    worker_report: DeliveryReport;
    expected: string;
  };
};

test("shared fixture keeps provider specs aligned with Python", () => {
  for (const provider of fixture.provider_specs) {
    assert.deepEqual(
      [...providerSecretFields(provider.type)].sort(),
      [...provider.secret_fields].sort()
    );
    assert.deepEqual(
      [...providerRequiredFields(provider.type)].sort(),
      [...provider.required_fields].sort()
    );
  }
});

test("shared fixture keeps price markdown aligned with Python", () => {
  const markdown = buildMerchantMarkdown(
    fixture.price_markdown.worker_processed,
    true
  );

  for (const expectedLine of fixture.price_markdown.expected_lines) {
    assert.ok(markdown.includes(expectedLine));
  }
});

test("shared fixture keeps delivery summaries aligned with Python", () => {
  assert.equal(
    deliverySummary(fixture.delivery_summary.worker_report),
    fixture.delivery_summary.expected
  );
});
