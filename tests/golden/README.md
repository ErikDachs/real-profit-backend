# Golden Tests (Real Profit Backend)

Ziel: Wenn diese Tests grün sind, ist die Profit-Engine + Aggregation + Insights stabil.
Wir testen bewusst NICHT Shopify-API live, sondern mit Fixtures + stubs.

## Struktur

tests/
  golden/
    fixtures/
      case01_happy_path.json
      case02_partial_refund.json
      case03_full_refund.json
      case04_missing_cogs.json
      case05_high_fees.json
      case06_shipping_subsidy.json
      case07_negative_cm.json
      case08_scenario_fee_minus_10pct.json
    profitEngine.golden.test.ts

## Was ist im Fixture?

Jeder Case hat:
- `name`
- `costConfig` (persistierte Baseline Kosten)
- `scenario` (optional: Deltas)
- `orders` (minimale Order-Objekte, so klein wie möglich)
- `cogs` (mapping variantId -> unitCost, damit COGS deterministisch ist)
- `expected` (Snapshot / JSON expected outputs)

## Regeln

- Geldwerte immer round2.
- Keine externen Calls.
- Wenn Output-Format sich ändern muss: Snapshot Update = bewusste Entscheidung.