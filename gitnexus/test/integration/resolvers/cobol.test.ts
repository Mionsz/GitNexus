/**
 * COBOL: Exhaustive strict integration test.
 *
 * Every single node and edge produced by the COBOL/JCL pipeline is asserted
 * with exact counts and exact sorted lists. No fuzzy assertions.
 *
 * Ground truth captured from the cobol-app fixture:
 *   CUSTUPDT.cbl  — 3 programs, 2 sections, 13 paragraphs, 21 data items,
 *   AUDITLOG.cbl    1 file declaration, 1 COPY, 1 EXEC SQL, 3 EXEC CICS,
 *   RPTGEN.cbl      1 ENTRY point, 3 MOVE pairs, 2 JCL jobs, 2 JCL steps,
 *   CUSTDAT.cpy     1 JCL dataset, cross-program CALL/LINK/XCTL resolution.
 *   RUNJOBS.jcl
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES, getRelationships, getNodesByLabel, edgeSet,
  runPipelineFromRepo, type PipelineResult,
} from './helpers.js';

describe('COBOL full system extraction', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(
      path.join(FIXTURES, 'cobol-app'),
      () => {},
      { skipGraphPhases: true }, // COBOL is regex-based, not in SupportedLanguages enum
    );
  }, 60000);

  // =====================================================================
  // NODE COMPLETENESS -- assert exact count and exact sorted list per label
  // =====================================================================

  describe('node completeness', () => {

    it('produces exactly 3 Module nodes', () => {
      const modules = getNodesByLabel(result, 'Module');
      expect(modules.length).toBe(3);
      expect(modules).toEqual(['AUDITLOG', 'CUSTUPDT', 'RPTGEN']);
    });

    it('produces exactly 13 Function nodes (paragraphs across all programs)', () => {
      const funcs = getNodesByLabel(result, 'Function');
      expect(funcs.length).toBe(13);
      // getNodesByLabel returns sorted names; MAIN-PARAGRAPH appears 3 times
      // (once per program: CUSTUPDT, RPTGEN, AUDITLOG — separate graph nodes
      // with different filePaths but same name, all returned by getNodesByLabel)
      expect(funcs).toEqual([
        'CLEANUP-PARAGRAPH',   // CUSTUPDT
        'FETCH-DATA',          // RPTGEN
        'FORMAT-REPORT',       // RPTGEN
        'INIT-PARAGRAPH',      // CUSTUPDT
        'MAIN-PARAGRAPH',      // AUDITLOG
        'MAIN-PARAGRAPH',      // CUSTUPDT
        'MAIN-PARAGRAPH',      // RPTGEN
        'PROCESS-PARAGRAPH',   // CUSTUPDT
        'READ-CUSTOMER',       // CUSTUPDT
        'SEND-SCREEN',         // RPTGEN
        'UPDATE-BALANCE',      // CUSTUPDT
        'WRITE-CUSTOMER',      // CUSTUPDT
        'WRITE-LOG',           // AUDITLOG
      ]);
    });

    it('produces exactly 2 Namespace nodes (PROCEDURE DIVISION sections)', () => {
      const ns = getNodesByLabel(result, 'Namespace');
      expect(ns.length).toBe(2);
      expect(ns).toEqual(['INIT-SECTION', 'PROCESSING-SECTION']);
    });

    it('produces exactly 21 Property nodes (data items + 88-levels)', () => {
      const props = getNodesByLabel(result, 'Property');
      expect(props.length).toBe(21);
      expect(props).toEqual([
        'CUST-BALANCE',
        'CUST-ID',
        'CUST-NAME',
        'CUSTOMER-RECORD',
        'END-OF-FILE',
        'LS-AMOUNT',
        'LS-CUST-ID',
        'PREMIUM-CUSTOMER',
        'REGULAR-CUSTOMER',
        'WS-AMOUNT',
        'WS-CUST-ADDR',
        'WS-CUST-CODE',
        'WS-CUST-TYPE',
        'WS-CUSTOMER-DATA',
        'WS-CUSTOMER-NAME',
        'WS-EOF',
        'WS-FILE-STATUS',
        'WS-LOG-MESSAGE',
        'WS-REPORT-LINE',
        'WS-SQL-CODE',
        'WS-TIMESTAMP',
      ]);
    });

    it('produces exactly 1 Record node (file declaration)', () => {
      const records = getNodesByLabel(result, 'Record');
      expect(records.length).toBe(1);
      expect(records).toEqual(['CUSTOMER-FILE']);
    });

    it('produces exactly 8 CodeElement nodes (EXEC blocks + JCL entities)', () => {
      const ce = getNodesByLabel(result, 'CodeElement');
      expect(ce.length).toBe(8);
      expect(ce).toEqual([
        'CUSTJOB',
        'EXEC CICS LINK',
        'EXEC CICS SEND MAP',
        'EXEC CICS XCTL',
        'EXEC SQL SELECT',
        'PROD.CUSTOMER.MASTER',
        'STEP1',
        'STEP2',
      ]);
    });

    it('produces exactly 1 Constructor node (ENTRY point)', () => {
      const constructors = getNodesByLabel(result, 'Constructor');
      expect(constructors.length).toBe(1);
      expect(constructors).toEqual(['AUDITLOG-BATCH']);
    });
  });

  // =====================================================================
  // EDGE COMPLETENESS -- assert exact count and exact pairs per type+reason
  // =====================================================================

  describe('edge completeness', () => {

    // -- ACCESSES edges -------------------------------------------------

    it('produces exactly 3 ACCESSES edges with reason cobol-move-read', () => {
      const edges = getRelationships(result, 'ACCESSES')
        .filter(e => e.rel.reason === 'cobol-move-read');
      expect(edges.length).toBe(3);
      expect(edgeSet(edges)).toEqual([
        'FORMAT-REPORT \u2192 WS-CUST-CODE',
        'READ-CUSTOMER \u2192 CUST-NAME',
        'UPDATE-BALANCE \u2192 WS-AMOUNT',
      ]);
    });

    it('produces exactly 3 ACCESSES edges with reason cobol-move-write', () => {
      const edges = getRelationships(result, 'ACCESSES')
        .filter(e => e.rel.reason === 'cobol-move-write');
      expect(edges.length).toBe(3);
      expect(edgeSet(edges)).toEqual([
        'FORMAT-REPORT \u2192 WS-REPORT-LINE',
        'READ-CUSTOMER \u2192 WS-CUSTOMER-NAME',
        'UPDATE-BALANCE \u2192 CUST-BALANCE',
      ]);
    });

    it('produces exactly 1 ACCESSES edge with reason sql-select (synthetic target)', () => {
      // The sql-select edge targets a synthetic Record node (<db>:CUSTOMER) that
      // is not materialized in the graph. We verify by filtering on reason only,
      // since getRelationships resolves sourceId/targetId to node names when nodes exist.
      const allAccesses = getRelationships(result, 'ACCESSES');
      const sqlAccesses = allAccesses.filter(e => e.rel.reason === 'sql-select');
      expect(sqlAccesses.length).toBe(1);
      expect(sqlAccesses[0].source).toBe('EXEC SQL SELECT');
    });

    it('produces exactly 7 total ACCESSES edges', () => {
      const edges = getRelationships(result, 'ACCESSES');
      expect(edges.length).toBe(7);
    });

    // -- CALLS edges: cobol-perform -------------------------------------

    it('produces exactly 9 CALLS edges with reason cobol-perform', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.rel.reason === 'cobol-perform');
      expect(edges.length).toBe(9);
      expect(edgeSet(edges)).toEqual([
        'FORMAT-REPORT \u2192 MAIN-PARAGRAPH',
        'MAIN-PARAGRAPH \u2192 CLEANUP-PARAGRAPH',
        'MAIN-PARAGRAPH \u2192 FETCH-DATA',
        'MAIN-PARAGRAPH \u2192 FORMAT-REPORT',
        'MAIN-PARAGRAPH \u2192 INIT-PARAGRAPH',
        'MAIN-PARAGRAPH \u2192 PROCESS-PARAGRAPH',
        'MAIN-PARAGRAPH \u2192 SEND-SCREEN',
        'MAIN-PARAGRAPH \u2192 WRITE-LOG',
        'PROCESS-PARAGRAPH \u2192 READ-CUSTOMER',
      ]);
    });

    // -- CALLS edges: cobol-perform-thru --------------------------------

    it('produces exactly 2 CALLS edges with reason cobol-perform-thru', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.rel.reason === 'cobol-perform-thru');
      expect(edges.length).toBe(2);
      expect(edgeSet(edges)).toEqual([
        'FORMAT-REPORT \u2192 FORMAT-REPORT',
        'PROCESS-PARAGRAPH \u2192 WRITE-CUSTOMER',
      ]);
    });

    // -- CALLS edges: cobol-call ----------------------------------------

    it('produces exactly 2 CALLS edges with reason cobol-call', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.rel.reason === 'cobol-call');
      expect(edges.length).toBe(2);
      expect(edgeSet(edges)).toEqual([
        'CUSTUPDT \u2192 AUDITLOG',
        'RPTGEN \u2192 CUSTUPDT',
      ]);
    });

    // -- CALLS edges: cics-link -----------------------------------------

    it('produces exactly 1 CALLS edge with reason cics-link', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.rel.reason === 'cics-link');
      expect(edges.length).toBe(1);
      expect(edgeSet(edges)).toEqual([
        'RPTGEN \u2192 AUDITLOG',
      ]);
    });

    // -- CALLS edges: cics-xctl -----------------------------------------

    it('produces exactly 1 CALLS edge with reason cics-xctl', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.rel.reason === 'cics-xctl');
      expect(edges.length).toBe(1);
      expect(edgeSet(edges)).toEqual([
        'RPTGEN \u2192 CUSTUPDT',
      ]);
    });

    // -- CALLS edges: unresolved (retained from first pass) ---------------

    it('produces exactly 2 CALLS edges with reason cobol-call-unresolved', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.rel.reason === 'cobol-call-unresolved');
      expect(edges.length).toBe(2);
      // CUSTUPDT -> AUDITLOG and RPTGEN -> CUSTUPDT were initially unresolved
      // because the target module had not yet been processed at the time.
      // The second pass adds resolved edges but does NOT remove these.
      expect(edges.map(e => e.source).sort()).toEqual(['CUSTUPDT', 'RPTGEN']);
    });

    it('produces exactly 1 CALLS edge with reason cics-link-unresolved', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.rel.reason === 'cics-link-unresolved');
      expect(edges.length).toBe(1);
      expect(edges[0].source).toBe('RPTGEN');
    });

    it('produces exactly 1 CALLS edge with reason cics-xctl-unresolved', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.rel.reason === 'cics-xctl-unresolved');
      expect(edges.length).toBe(1);
      expect(edges[0].source).toBe('RPTGEN');
    });

    // -- CALLS edges: jcl-exec-pgm --------------------------------------

    it('produces exactly 2 CALLS edges with reason jcl-exec-pgm', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.rel.reason === 'jcl-exec-pgm');
      expect(edges.length).toBe(2);
      expect(edgeSet(edges)).toEqual([
        'STEP1 \u2192 CUSTUPDT',
        'STEP2 \u2192 RPTGEN',
      ]);
    });

    // -- CALLS edges: jcl-dd:CUSTFILE -----------------------------------

    it('produces exactly 1 CALLS edge with reason jcl-dd:CUSTFILE', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.rel.reason === 'jcl-dd:CUSTFILE');
      expect(edges.length).toBe(1);
      expect(edgeSet(edges)).toEqual([
        'STEP1 \u2192 PROD.CUSTOMER.MASTER',
      ]);
    });

    // -- CONTAINS edges: cobol-program-id -------------------------------

    it('produces exactly 3 CONTAINS edges with reason cobol-program-id', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.rel.reason === 'cobol-program-id');
      expect(edges.length).toBe(3);
      expect(edgeSet(edges)).toEqual([
        'AUDITLOG.cbl \u2192 AUDITLOG',
        'CUSTUPDT.cbl \u2192 CUSTUPDT',
        'RPTGEN.cbl \u2192 RPTGEN',
      ]);
    });

    // -- CONTAINS edges: cobol-section ----------------------------------

    it('produces exactly 2 CONTAINS edges with reason cobol-section', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.rel.reason === 'cobol-section');
      expect(edges.length).toBe(2);
      expect(edgeSet(edges)).toEqual([
        'CUSTUPDT \u2192 INIT-SECTION',
        'CUSTUPDT \u2192 PROCESSING-SECTION',
      ]);
    });

    // -- CONTAINS edges: cobol-paragraph --------------------------------

    it('produces exactly 13 CONTAINS edges with reason cobol-paragraph', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.rel.reason === 'cobol-paragraph');
      expect(edges.length).toBe(13);
      expect(edgeSet(edges)).toEqual([
        'AUDITLOG \u2192 MAIN-PARAGRAPH',
        'AUDITLOG \u2192 WRITE-LOG',
        'INIT-SECTION \u2192 INIT-PARAGRAPH',
        'INIT-SECTION \u2192 MAIN-PARAGRAPH',
        'PROCESSING-SECTION \u2192 CLEANUP-PARAGRAPH',
        'PROCESSING-SECTION \u2192 PROCESS-PARAGRAPH',
        'PROCESSING-SECTION \u2192 READ-CUSTOMER',
        'PROCESSING-SECTION \u2192 UPDATE-BALANCE',
        'PROCESSING-SECTION \u2192 WRITE-CUSTOMER',
        'RPTGEN \u2192 FETCH-DATA',
        'RPTGEN \u2192 FORMAT-REPORT',
        'RPTGEN \u2192 MAIN-PARAGRAPH',
        'RPTGEN \u2192 SEND-SCREEN',
      ]);
    });

    // -- CONTAINS edges: cobol-data-item --------------------------------

    it('produces exactly 21 CONTAINS edges with reason cobol-data-item', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.rel.reason === 'cobol-data-item');
      expect(edges.length).toBe(21);
      expect(edgeSet(edges)).toEqual([
        'AUDITLOG \u2192 LS-AMOUNT',
        'AUDITLOG \u2192 LS-CUST-ID',
        'AUDITLOG \u2192 WS-LOG-MESSAGE',
        'AUDITLOG \u2192 WS-TIMESTAMP',
        'CUSTUPDT \u2192 CUST-BALANCE',
        'CUSTUPDT \u2192 CUST-ID',
        'CUSTUPDT \u2192 CUST-NAME',
        'CUSTUPDT \u2192 CUSTOMER-RECORD',
        'CUSTUPDT \u2192 END-OF-FILE',
        'CUSTUPDT \u2192 WS-AMOUNT',
        'CUSTUPDT \u2192 WS-CUSTOMER-NAME',
        'CUSTUPDT \u2192 WS-EOF',
        'CUSTUPDT \u2192 WS-FILE-STATUS',
        'RPTGEN \u2192 PREMIUM-CUSTOMER',
        'RPTGEN \u2192 REGULAR-CUSTOMER',
        'RPTGEN \u2192 WS-CUST-ADDR',
        'RPTGEN \u2192 WS-CUST-CODE',
        'RPTGEN \u2192 WS-CUST-TYPE',
        'RPTGEN \u2192 WS-CUSTOMER-DATA',
        'RPTGEN \u2192 WS-REPORT-LINE',
        'RPTGEN \u2192 WS-SQL-CODE',
      ]);
    });

    // -- CONTAINS edges: cobol-exec-sql ---------------------------------

    it('produces exactly 1 CONTAINS edge with reason cobol-exec-sql', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.rel.reason === 'cobol-exec-sql');
      expect(edges.length).toBe(1);
      expect(edgeSet(edges)).toEqual([
        'RPTGEN \u2192 EXEC SQL SELECT',
      ]);
    });

    // -- CONTAINS edges: cobol-exec-cics --------------------------------

    it('produces exactly 3 CONTAINS edges with reason cobol-exec-cics', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.rel.reason === 'cobol-exec-cics');
      expect(edges.length).toBe(3);
      expect(edgeSet(edges)).toEqual([
        'RPTGEN \u2192 EXEC CICS LINK',
        'RPTGEN \u2192 EXEC CICS SEND MAP',
        'RPTGEN \u2192 EXEC CICS XCTL',
      ]);
    });

    // -- CONTAINS edges: cobol-entry-point ------------------------------

    it('produces exactly 1 CONTAINS edge with reason cobol-entry-point', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.rel.reason === 'cobol-entry-point');
      expect(edges.length).toBe(1);
      expect(edgeSet(edges)).toEqual([
        'AUDITLOG \u2192 AUDITLOG-BATCH',
      ]);
    });

    // -- CONTAINS edges: cobol-file-declaration -------------------------

    it('produces exactly 1 CONTAINS edge with reason cobol-file-declaration', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.rel.reason === 'cobol-file-declaration');
      expect(edges.length).toBe(1);
      expect(edgeSet(edges)).toEqual([
        'CUSTUPDT \u2192 CUSTOMER-FILE',
      ]);
    });

    // -- CONTAINS edges: jcl-job ----------------------------------------

    it('produces exactly 1 CONTAINS edge with reason jcl-job', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.rel.reason === 'jcl-job');
      expect(edges.length).toBe(1);
      expect(edgeSet(edges)).toEqual([
        'RUNJOBS.jcl \u2192 CUSTJOB',
      ]);
    });

    // -- CONTAINS edges: jcl-step ---------------------------------------

    it('produces exactly 2 CONTAINS edges with reason jcl-step', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.rel.reason === 'jcl-step');
      expect(edges.length).toBe(2);
      expect(edgeSet(edges)).toEqual([
        'CUSTJOB \u2192 STEP1',
        'CUSTJOB \u2192 STEP2',
      ]);
    });

    // -- IMPORTS edges: cobol-copy --------------------------------------

    it('produces exactly 1 IMPORTS edge with reason cobol-copy', () => {
      const edges = getRelationships(result, 'IMPORTS')
        .filter(e => e.rel.reason === 'cobol-copy');
      expect(edges.length).toBe(1);
      expect(edges[0].sourceFilePath).toMatch(/RPTGEN\.cbl$/);
      expect(edges[0].targetFilePath).toMatch(/CUSTDAT\.cpy$/);
    });
  });

  // =====================================================================
  // CROSS-PROGRAM RESOLUTION -- verify specific resolved edges
  // =====================================================================

  describe('cross-program resolution', () => {

    it('CUSTUPDT CALL "AUDITLOG" resolves to Module node', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.source === 'CUSTUPDT' && e.target === 'AUDITLOG' && e.rel.reason === 'cobol-call');
      expect(edges.length).toBe(1);
      expect(edges[0].sourceLabel).toBe('Module');
      expect(edges[0].targetLabel).toBe('Module');
    });

    it('RPTGEN CALL "CUSTUPDT" resolves to Module node', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.source === 'RPTGEN' && e.target === 'CUSTUPDT' && e.rel.reason === 'cobol-call');
      expect(edges.length).toBe(1);
      expect(edges[0].sourceLabel).toBe('Module');
      expect(edges[0].targetLabel).toBe('Module');
    });

    it('RPTGEN CICS LINK AUDITLOG resolves to Module node', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.source === 'RPTGEN' && e.target === 'AUDITLOG' && e.rel.reason === 'cics-link');
      expect(edges.length).toBe(1);
      expect(edges[0].sourceLabel).toBe('Module');
      expect(edges[0].targetLabel).toBe('Module');
    });

    it('RPTGEN CICS XCTL CUSTUPDT resolves to Module node', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.source === 'RPTGEN' && e.target === 'CUSTUPDT' && e.rel.reason === 'cics-xctl');
      expect(edges.length).toBe(1);
      expect(edges[0].sourceLabel).toBe('Module');
      expect(edges[0].targetLabel).toBe('Module');
    });

    it('JCL STEP1 links to CUSTUPDT Module via jcl-exec-pgm', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.source === 'STEP1' && e.target === 'CUSTUPDT' && e.rel.reason === 'jcl-exec-pgm');
      expect(edges.length).toBe(1);
      expect(edges[0].sourceLabel).toBe('CodeElement');
      expect(edges[0].targetLabel).toBe('Module');
    });

    it('JCL STEP2 links to RPTGEN Module via jcl-exec-pgm', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.source === 'STEP2' && e.target === 'RPTGEN' && e.rel.reason === 'jcl-exec-pgm');
      expect(edges.length).toBe(1);
      expect(edges[0].sourceLabel).toBe('CodeElement');
      expect(edges[0].targetLabel).toBe('Module');
    });
  });

  // =====================================================================
  // COPY EXPANSION -- verify copybook data items appear in host program
  // =====================================================================

  describe('COPY expansion', () => {

    it('RPTGEN IMPORTS CUSTDAT copybook', () => {
      const imports = getRelationships(result, 'IMPORTS')
        .filter(e => e.rel.reason === 'cobol-copy');
      expect(imports.length).toBe(1);
      expect(imports[0].sourceFilePath).toMatch(/RPTGEN\.cbl$/);
      expect(imports[0].targetFilePath).toMatch(/CUSTDAT\.cpy$/);
    });

    it('copybook data items appear as Property nodes owned by RPTGEN', () => {
      const contains = getRelationships(result, 'CONTAINS')
        .filter(e => e.source === 'RPTGEN' && e.rel.reason === 'cobol-data-item');
      const targets = contains.map(e => e.target).sort();
      expect(targets).toEqual([
        'PREMIUM-CUSTOMER',
        'REGULAR-CUSTOMER',
        'WS-CUST-ADDR',
        'WS-CUST-CODE',
        'WS-CUST-TYPE',
        'WS-CUSTOMER-DATA',
        'WS-REPORT-LINE',
        'WS-SQL-CODE',
      ]);
    });
  });

  // =====================================================================
  // SECTION-TO-PARAGRAPH HIERARCHY -- exact structure
  // =====================================================================

  describe('section-to-paragraph hierarchy', () => {

    it('INIT-SECTION contains exactly 2 paragraphs', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.source === 'INIT-SECTION' && e.rel.reason === 'cobol-paragraph');
      expect(edges.length).toBe(2);
      expect(edges.map(e => e.target).sort()).toEqual([
        'INIT-PARAGRAPH',
        'MAIN-PARAGRAPH',
      ]);
    });

    it('PROCESSING-SECTION contains exactly 5 paragraphs', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.source === 'PROCESSING-SECTION' && e.rel.reason === 'cobol-paragraph');
      expect(edges.length).toBe(5);
      expect(edges.map(e => e.target).sort()).toEqual([
        'CLEANUP-PARAGRAPH',
        'PROCESS-PARAGRAPH',
        'READ-CUSTOMER',
        'UPDATE-BALANCE',
        'WRITE-CUSTOMER',
      ]);
    });

    it('RPTGEN (no sections) contains exactly 4 paragraphs directly', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.source === 'RPTGEN' && e.rel.reason === 'cobol-paragraph');
      expect(edges.length).toBe(4);
      expect(edges.map(e => e.target).sort()).toEqual([
        'FETCH-DATA',
        'FORMAT-REPORT',
        'MAIN-PARAGRAPH',
        'SEND-SCREEN',
      ]);
    });

    it('AUDITLOG (no sections) contains exactly 2 paragraphs directly', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.source === 'AUDITLOG' && e.rel.reason === 'cobol-paragraph');
      expect(edges.length).toBe(2);
      expect(edges.map(e => e.target).sort()).toEqual([
        'MAIN-PARAGRAPH',
        'WRITE-LOG',
      ]);
    });
  });

  // =====================================================================
  // DATA ITEM OWNERSHIP -- exact per-module breakdown
  // =====================================================================

  describe('data item ownership', () => {

    it('CUSTUPDT owns exactly 9 data items', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.source === 'CUSTUPDT' && e.rel.reason === 'cobol-data-item');
      expect(edges.length).toBe(9);
      expect(edges.map(e => e.target).sort()).toEqual([
        'CUST-BALANCE',
        'CUST-ID',
        'CUST-NAME',
        'CUSTOMER-RECORD',
        'END-OF-FILE',
        'WS-AMOUNT',
        'WS-CUSTOMER-NAME',
        'WS-EOF',
        'WS-FILE-STATUS',
      ]);
    });

    it('AUDITLOG owns exactly 4 data items', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.source === 'AUDITLOG' && e.rel.reason === 'cobol-data-item');
      expect(edges.length).toBe(4);
      expect(edges.map(e => e.target).sort()).toEqual([
        'LS-AMOUNT',
        'LS-CUST-ID',
        'WS-LOG-MESSAGE',
        'WS-TIMESTAMP',
      ]);
    });

    it('RPTGEN owns exactly 8 data items (including expanded copybook)', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.source === 'RPTGEN' && e.rel.reason === 'cobol-data-item');
      expect(edges.length).toBe(8);
      expect(edges.map(e => e.target).sort()).toEqual([
        'PREMIUM-CUSTOMER',
        'REGULAR-CUSTOMER',
        'WS-CUST-ADDR',
        'WS-CUST-CODE',
        'WS-CUST-TYPE',
        'WS-CUSTOMER-DATA',
        'WS-REPORT-LINE',
        'WS-SQL-CODE',
      ]);
    });
  });

  // =====================================================================
  // MOVE DATA FLOW -- exact source->target pairs
  // =====================================================================

  describe('MOVE data flow', () => {

    it('READ-CUSTOMER reads CUST-NAME and writes WS-CUSTOMER-NAME', () => {
      const accesses = getRelationships(result, 'ACCESSES');
      const reads = accesses.filter(e =>
        e.source === 'READ-CUSTOMER' && e.rel.reason === 'cobol-move-read',
      );
      expect(reads.length).toBe(1);
      expect(reads[0].target).toBe('CUST-NAME');

      const writes = accesses.filter(e =>
        e.source === 'READ-CUSTOMER' && e.rel.reason === 'cobol-move-write',
      );
      expect(writes.length).toBe(1);
      expect(writes[0].target).toBe('WS-CUSTOMER-NAME');
    });

    it('UPDATE-BALANCE reads WS-AMOUNT and writes CUST-BALANCE', () => {
      const accesses = getRelationships(result, 'ACCESSES');
      const reads = accesses.filter(e =>
        e.source === 'UPDATE-BALANCE' && e.rel.reason === 'cobol-move-read',
      );
      expect(reads.length).toBe(1);
      expect(reads[0].target).toBe('WS-AMOUNT');

      const writes = accesses.filter(e =>
        e.source === 'UPDATE-BALANCE' && e.rel.reason === 'cobol-move-write',
      );
      expect(writes.length).toBe(1);
      expect(writes[0].target).toBe('CUST-BALANCE');
    });

    it('FORMAT-REPORT reads WS-CUST-CODE and writes WS-REPORT-LINE', () => {
      const accesses = getRelationships(result, 'ACCESSES');
      const reads = accesses.filter(e =>
        e.source === 'FORMAT-REPORT' && e.rel.reason === 'cobol-move-read',
      );
      expect(reads.length).toBe(1);
      expect(reads[0].target).toBe('WS-CUST-CODE');

      const writes = accesses.filter(e =>
        e.source === 'FORMAT-REPORT' && e.rel.reason === 'cobol-move-write',
      );
      expect(writes.length).toBe(1);
      expect(writes[0].target).toBe('WS-REPORT-LINE');
    });
  });

  // =====================================================================
  // JCL INTEGRATION -- exact structure
  // =====================================================================

  describe('JCL integration', () => {

    it('CUSTJOB job is contained by RUNJOBS.jcl file', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.rel.reason === 'jcl-job');
      expect(edges.length).toBe(1);
      expect(edges[0].source).toBe('RUNJOBS.jcl');
      expect(edges[0].target).toBe('CUSTJOB');
      expect(edges[0].sourceLabel).toBe('File');
      expect(edges[0].targetLabel).toBe('CodeElement');
    });

    it('CUSTJOB contains exactly 2 steps', () => {
      const edges = getRelationships(result, 'CONTAINS')
        .filter(e => e.source === 'CUSTJOB' && e.rel.reason === 'jcl-step');
      expect(edges.length).toBe(2);
      expect(edges.map(e => e.target).sort()).toEqual(['STEP1', 'STEP2']);
    });

    it('STEP1 references PROD.CUSTOMER.MASTER dataset via jcl-dd:CUSTFILE', () => {
      const edges = getRelationships(result, 'CALLS')
        .filter(e => e.rel.reason === 'jcl-dd:CUSTFILE');
      expect(edges.length).toBe(1);
      expect(edges[0].source).toBe('STEP1');
      expect(edges[0].target).toBe('PROD.CUSTOMER.MASTER');
      expect(edges[0].sourceLabel).toBe('CodeElement');
      expect(edges[0].targetLabel).toBe('CodeElement');
    });
  });

  // =====================================================================
  // GRAND TOTALS -- ensure no unexpected edges leak in
  // =====================================================================

  describe('grand totals', () => {

    it('produces exactly 22 total CALLS edges (18 resolved + 4 unresolved)', () => {
      // Resolved edges:
      //   9 cobol-perform + 2 cobol-perform-thru + 2 cobol-call +
      //   1 cics-link + 1 cics-xctl + 2 jcl-exec-pgm + 1 jcl-dd:CUSTFILE = 18
      // Unresolved edges (retained from first pass before cross-program resolution):
      //   2 cobol-call-unresolved + 1 cics-link-unresolved + 1 cics-xctl-unresolved = 4
      // Grand total: 22
      const edges = getRelationships(result, 'CALLS');
      expect(edges.length).toBe(22);
    });

    it('produces exactly 48 total CONTAINS edges', () => {
      // 3 cobol-program-id + 2 cobol-section + 13 cobol-paragraph +
      // 21 cobol-data-item + 1 cobol-exec-sql + 3 cobol-exec-cics +
      // 1 cobol-entry-point + 1 cobol-file-declaration +
      // 1 jcl-job + 2 jcl-step = 48
      const edges = getRelationships(result, 'CONTAINS');
      expect(edges.length).toBe(48);
    });

    it('produces exactly 1 total IMPORTS edge', () => {
      const edges = getRelationships(result, 'IMPORTS');
      expect(edges.length).toBe(1);
    });

    it('produces exactly 7 total ACCESSES edges', () => {
      // 3 cobol-move-read + 3 cobol-move-write + 1 sql-select = 7
      const edges = getRelationships(result, 'ACCESSES');
      expect(edges.length).toBe(7);
    });
  });
});
