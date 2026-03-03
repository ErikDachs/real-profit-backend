# Real Profit — Backend Definition of Done (DoD)

Diese Liste ist die **harte Grenze**. Sie wird **nicht erweitert**.
Alles, was nicht hier steht, ist “later” und darf das Backend nicht blockieren.

## Grundprinzipien (nicht verhandelbar)

- **Single Source of Truth:** Eine zentrale Order-Profit-Logik (keine Shadow-Calculations).
- **Deterministisch:** gleiche Inputs => gleiche Outputs (inkl. Ranking).
- **Profit First:** Alles dient Profit-Transparenz oder Profit-Optimierung.
- **Keine doppelte Logik:** Aggregationen & Insights lesen nur aus OrderProfitRows / Aggregaten.

---

## 1) Domain Outputs: “OrderProfitRow” ist vollständig

### Pflicht-Felder pro Order (final)

OrderProfitRow muss pro Bestellung **mindestens** diese operativen Felder liefern:

- Identität / Zeit:
  - `id`
  - `createdAt` (ISO string oder null)
  - `currency` (Store currency)

- Umsatz / Refunds:
  - `grossSales`
  - `refunds`
  - `netAfterRefunds`

- Variable Kosten:
  - `cogs`
  - `paymentFees`

- Shipping:
  - `shippingRevenue` (wenn verfügbar)
  - `shippingCost` (aus CostConfig / Rule)
  - `profitAfterShipping` (netAfterRefunds - cogs - paymentFees + shippingRevenue - shippingCost)

- Contribution:
  - `contributionMargin` (mind. netAfterRefunds - cogs - paymentFees +/- shipping effect je nach Definition)
  - `contributionMarginPct`

- Ads:
  - `adSpendAllocated` (simple baseline/allocation, deterministic)
  - `profitAfterAds` (profitAfterShipping - adSpendAllocated)

> Definition klar halten:
> - Wenn du Contribution Margin *ohne* Shipping definierst, dann profitAfterShipping ist separater Layer.
> - Wichtig ist: die Felder sind immer gleich befüllt und in Aggregationen gleich interpretiert.

✅ DoD Check:
- Keine NaNs, keine undefined in Numerics (immer number, ggf. 0).
- Rounding-Regel: Geldwerte immer `round2`.
- Refund-Handling korrekt (Full + Partial).
- Missing COGS sichtbar (z. B. `cogsMissing=true` meta oder missing count im Summary).

---

## 2) Aggregations: Daily & Products sind nur “Views” auf OrderProfitRows

### Daily Profit Aggregation (final)

Aus OrderProfitRows berechnen:

- `orders`
- `grossSales`, `refunds`, `netAfterRefunds`
- `cogs`, `paymentFees`
- `shippingRevenue`, `shippingCost`
- `contributionMargin`, `contributionMarginPct`
- `adSpendAllocated` (daily sum)
- `profitAfterAds`
- optional: `breakEvenRoas` / `adSpendBreakEven` wenn Teil deiner Metrics-Definition

✅ DoD Check:
- Summe der Tage == Summe der Orders (für Summenfelder).
- Deterministisch sortiert (day asc).
- Keine doppelte Logik: Daily nutzt nur OrderProfitRows.

### Product Profit Aggregation (final)

Aus Orders/LineItems + Allocation (refunds/fees/ads/shipping falls du es so machst) deterministisch:

- `productId`, `variantId`, `title`, `variantTitle`, `sku`
- `qty`
- `grossSales`, `refundsAllocated`, `netSales`
- `cogs`, `paymentFeesAllocated`
- `contributionMargin` (+ pct optional)
- optional: `adSpendAllocated`, `profitAfterAds`

✅ DoD Check:
- Summe `grossSales` products == Summe `grossSales` orders (oder erklärbar durch Allocation-Regel).
- Allocation-Regel dokumentiert (proportional zu netSales o.ä.)

---

## 3) Insights: Profit Killers & Opportunities sind “deterministische Listen”

### Profit Killers (final)

Endpoint liefert:
- totals + period label
- list of ranked killers (deterministic ranking)
- je killer: `type`, `title`, `summary`, `estimatedMonthlyLoss`, `meta`, `actions`
- drilldown: IDs / handles (z. B. `orderIds`, `productIds`) damit UI klicken kann

✅ DoD Check:
- Ranking stabil (same inputs -> same ordering).
- `estimatedMonthlyLoss` basiert auf klarer Formel (hochgerechnet auf 30 Tage o.ä.).

### Opportunities (final)

Analog:
- ranked opportunities
- drilldown data
- actions (stable `code` identifiers)

✅ DoD Check:
- Gleiches Ranking-Prinzip, gleiche Hochrechnungsbasis.

---

## 4) Scenario Engine: Baseline vs Scenario (keine neuen Pfade)

Scenario muss:
- Baseline aus **persistierter CostConfig**
- Scenario = Baseline + Delta(s)
- Dann **vollständig** durch dieselbe Profit-Engine rechnen
- Output:
  - `baselineTotals`
  - `scenarioTotals`
  - `deltaAbs`, `deltaPct`
  - optional: top driver deltas (Fees/COGS/Shipping/Ads)

✅ DoD Check:
- Kein Default-Fallback außer “0” wenn Kosten fehlen.
- Scenario verändert nur Inputs, nicht die Logik.

---

## 5) Golden Tests: “Wenn die grün sind, ist Backend stabil”

Wir definieren 8–10 Golden Cases als Fixtures:
- Input = Orders + Config + ggf. mock shopifyGET/cogs
- Expected = Snapshot/JSON von:
  - OrderProfitRow(s)
  - OrdersSummary Totals
  - Daily Aggregation
  - ProfitKillers Ranking
  - Scenario Delta

✅ DoD Check:
- Tests laufen lokal in <1s
- Ein neues Feature darf erst rein, wenn Golden Cases nicht brechen
- Änderungen am Output sind “breaking” und müssen bewusst sein (Snapshot Update = Entscheidung)

---

## 6) “Was ab jetzt NICHT blockt” (Explizit später)

Diese Dinge sind NICHT Teil des Backend DoD:
- Multi-Channel Ad Attribution
- Multi-Currency komplizierte Konvertierungen
- Perfekte Shipping Cost Modelle pro Carrier/Zone
- UI/Frontend Polish
- Advanced cohort analytics

Wenn etwas davon auftaucht: “later”.

---

# Abschlusskriterium

Backend gilt als “fertig genug” wenn:

- [ ] OrderProfitRow vollständig + deterministisch
- [ ] Daily Aggregation vollständig
- [ ] Product Aggregation vollständig
- [ ] Profit Killers & Opportunities liefern ranked list + drilldown IDs
- [ ] Scenario Baseline vs Scenario sauber + delta
- [ ] Golden Tests (8–10) grün

Danach: Frontend darf sauber aufbauen, ohne dass sich Rechenlogik ständig bewegt.