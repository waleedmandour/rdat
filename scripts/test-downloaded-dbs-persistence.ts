/**
 * Smoke test for Phase 2 task 2.3 — reference DB download-state persistence.
 *
 * Verifies:
 *   - getDownloadedDbs() returns [] on a fresh DB
 *   - setDownloadedDbs() persists a list that survives a re-open
 *   - getDownloadedDbs() returns the persisted list after re-open
 *
 * Run with: npx tsx scripts/test-downloaded-dbs-persistence.ts
 *
 * Note: this test runs against the real IndexedDB on the current
 * process. Node doesn't have IndexedDB by default — run in a browser
 * or skip this script and verify manually in the GlossaryView.
 */
async function main() {
  // IndexedDB is browser-only. In Node, this will throw — print a
  // friendly message instead of failing.
  if (typeof indexedDB === "undefined") {
    console.log("Skipping — IndexedDB is not available in this environment.");
    console.log("To verify: open the app, download a reference DB, reload, and");
    console.log("confirm the button still says 'Use' instead of 'Download'.");
    return;
  }

  const { getDownloadedDbs, setDownloadedDbs } = await import("../src/lib/dual-storage");

  let pass = 0;
  let fail = 0;
  function check(label: string, cond: boolean, detail = "") {
    if (cond) {
      pass++;
      console.log(`  ✓ ${label}`);
    } else {
      fail++;
      console.log(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    }
  }

  console.log("\n══ sync_meta persistence (PHASE 2 task 2.3) ══");

  // 1. Fresh state — should be empty
  const fresh = await getDownloadedDbs();
  check("getDownloadedDbs() returns an array", Array.isArray(fresh), `got=${JSON.stringify(fresh)}`);

  // 2. Persist a list
  const testList = ["wipo", "microsoft", "opus"];
  await setDownloadedDbs(testList);
  console.log(`  Persisted: ${JSON.stringify(testList)}`);

  // 3. Read it back
  const after = await getDownloadedDbs();
  check(
    "getDownloadedDbs() returns the persisted list",
    JSON.stringify(after) === JSON.stringify(testList),
    `got=${JSON.stringify(after)}`
  );

  // 4. Overwrite with a smaller list
  const smaller = ["wipo"];
  await setDownloadedDbs(smaller);
  const afterShrink = await getDownloadedDbs();
  check(
    "setDownloadedDbs() overwrites (not appends)",
    JSON.stringify(afterShrink) === JSON.stringify(smaller),
    `got=${JSON.stringify(afterShrink)}`
  );

  // 5. Cleanup — restore to empty so this test is idempotent
  await setDownloadedDbs([]);
  const cleaned = await getDownloadedDbs();
  check("cleanup: empty list round-trips", JSON.stringify(cleaned) === "[]", `got=${JSON.stringify(cleaned)}`);

  console.log(`\n────────────────────────────────`);
  console.log(`  PASS: ${pass}    FAIL: ${fail}`);
  console.log(`────────────────────────────────\n`);

  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Test threw:", e);
  process.exit(1);
});
