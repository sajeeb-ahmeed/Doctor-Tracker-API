# Indexed search verification

Verified with real MongoDB 8.0.16 on 13 October 2026. This is a selective test fixture, not a production-load benchmark.

Reproduce with:

```powershell
npm test -- --reporter=verbose --silent=false
```

The `indexed search query plans` integration test inserts a 250-doctor benchmark fixture alongside the workflow doctor, then executes this representative prefix search combined with exact filters and stable sorting:

```javascript
Doctor.find({
  $and: [{ searchTokens: /^benchmark249/ }],
  specialization: 'Performance',
  hospital: 'Benchmark Hospital',
})
  .sort({ createdAt: -1, _id: -1 })
  .limit(10)
  .explain('executionStats');
```

Observed execution:

| Metric               | Result                             |
| -------------------- | ---------------------------------- |
| Collection documents | 251                                |
| Documents returned   | 1                                  |
| Index keys examined  | 2                                  |
| Documents examined   | 1                                  |
| Winning index        | `searchTokens_1`                   |
| Scan                 | `IXSCAN`                           |
| Prefix bounds        | `["benchmark249", "benchmark24:")` |

The planner chooses the selective single-field multikey search index, then applies hospital/specialization filters during `FETCH` and sorts the single returned record. Compound filter/search indexes are also present, but indexes do not guarantee every combination avoids a sort. Equality-only listings have compound date/sort indexes. Broad prefixes, multiple query tokens, and different data distributions can examine more keys and choose different plans; monitor actual production queries before adding indexes.

Search words use Unicode normalization and lowercase tokens. The regex prefix is case-sensitive on those normalized stored tokens, allowing index bounds. Arbitrary infix matching is outside this search contract. Tokens update on create and patient edit; the same test confirms startup migration makes older records searchable without replacing their data.
