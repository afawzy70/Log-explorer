import { describe, expect, it } from 'vitest';
import {
  addCondition,
  addGroup,
  depthOf,
  emptyCondition,
  emptyGroup,
  escapeDslString,
  hasAnyCondition,
  MAX_GUIDED_DEPTH,
  operatorsFor,
  removeNode,
  serializeQueryTree,
  setGroupCombinator,
  updateCondition,
} from './queryAuthoring';

describe('queryAuthoring', () => {
  describe('serializeQueryTree', () => {
    it('serializes an empty root to an empty string (no DSL filter)', () => {
      expect(serializeQueryTree(emptyGroup())).toBe('');
    });

    it('serializes a single condition with no parentheses', () => {
      const root = emptyGroup('AND');
      root.children = [{ kind: 'condition', id: '1', field: 'service', operator: '=', value: 'gateway' }];
      expect(serializeQueryTree(root)).toBe('service = "gateway"');
    });

    it('joins two AND conditions without wrapping conditions in parens', () => {
      const root = emptyGroup('AND');
      root.children = [
        { kind: 'condition', id: '1', field: 'service', operator: '=', value: 'gateway' },
        { kind: 'condition', id: '2', field: 'level', operator: '=', value: 'ERROR' },
      ];
      expect(serializeQueryTree(root)).toBe('service = "gateway" AND level = "ERROR"');
    });

    it('joins OR conditions with OR', () => {
      const root = emptyGroup('OR');
      root.children = [
        { kind: 'condition', id: '1', field: 'level', operator: '=', value: 'ERROR' },
        { kind: 'condition', id: '2', field: 'level', operator: '=', value: 'WARN' },
      ];
      expect(serializeQueryTree(root)).toBe('level = "ERROR" OR level = "WARN"');
    });

    it('parenthesizes a nested subgroup - the exact browser-verification shape "service = X AND (level = ERROR OR level = WARN)"', () => {
      const root = emptyGroup('AND');
      const sub = emptyGroup('OR');
      sub.children = [
        { kind: 'condition', id: '2', field: 'level', operator: '=', value: 'ERROR' },
        { kind: 'condition', id: '3', field: 'level', operator: '=', value: 'WARN' },
      ];
      root.children = [{ kind: 'condition', id: '1', field: 'service', operator: '=', value: 'gateway' }, sub];
      expect(serializeQueryTree(root)).toBe('service = "gateway" AND (level = "ERROR" OR level = "WARN")');
    });

    it('never parenthesizes the root group itself', () => {
      const root = emptyGroup('OR');
      root.children = [{ kind: 'condition', id: '1', field: 'service', operator: '=', value: 'gateway' }];
      expect(serializeQueryTree(root)).not.toMatch(/^\(/);
    });

    it('escapes embedded quotes and backslashes the same way the backend lexer expects to unescape them', () => {
      const root = emptyGroup('AND');
      root.children = [{ kind: 'condition', id: '1', field: 'message', operator: 'contains', value: 'say "hi" \\ bye' }];
      expect(serializeQueryTree(root)).toBe('message contains "say \\"hi\\" \\\\ bye"');
    });

    it('an empty subgroup contributes nothing to the serialized text', () => {
      const root = emptyGroup('AND');
      root.children = [
        { kind: 'condition', id: '1', field: 'service', operator: '=', value: 'gateway' },
        emptyGroup('OR'),
      ];
      expect(serializeQueryTree(root)).toBe('service = "gateway"');
    });

    it('an empty-string literal value is still a valid, included comparison (matches backend allowance)', () => {
      const root = emptyGroup('AND');
      root.children = [{ kind: 'condition', id: '1', field: 'service', operator: '=', value: '' }];
      expect(serializeQueryTree(root)).toBe('service = ""');
    });
  });

  describe('escapeDslString', () => {
    it('escapes backslashes before quotes so double-escaping never happens', () => {
      expect(escapeDslString('a\\b')).toBe('a\\\\b');
      expect(escapeDslString('a"b')).toBe('a\\"b');
      expect(escapeDslString('a\\"b')).toBe('a\\\\\\"b');
    });
  });

  describe('operatorsFor', () => {
    it('never offers "contains" for a sensitive alias (userName/customerId/cif)', () => {
      expect(operatorsFor('userName')).toEqual(['=', '!=']);
      expect(operatorsFor('customerId')).toEqual(['=', '!=']);
      expect(operatorsFor('cif')).toEqual(['=', '!=']);
    });

    it('offers all three operators for a non-sensitive field', () => {
      expect(operatorsFor('message')).toEqual(['=', '!=', 'contains']);
      expect(operatorsFor('service')).toEqual(['=', '!=', 'contains']);
    });
  });

  describe('tree mutation helpers', () => {
    it('addCondition appends an empty condition to the target group', () => {
      const root = emptyGroup('AND');
      const next = addCondition(root, root.id);
      expect(next.children).toHaveLength(1);
      expect(next.children[0]).toMatchObject({ kind: 'condition', field: 'service', operator: '=', value: '' });
      // immutable - the original is untouched
      expect(root.children).toHaveLength(0);
    });

    it('addGroup appends a nested subgroup up to MAX_GUIDED_DEPTH, then refuses (no-op) beyond it', () => {
      let root = emptyGroup('AND');
      root = addGroup(root, root.id);
      expect(root.children).toHaveLength(1);
      expect(root.children[0].kind).toBe('group');
      const subGroupId = (root.children[0] as { id: string }).id;
      expect(depthOf(root)).toBe(MAX_GUIDED_DEPTH);

      // attempting to nest one level deeper than the bound is a no-op
      const attempted = addGroup(root, subGroupId);
      expect(attempted).toEqual(root);
    });

    it('setGroupCombinator flips AND/OR for the targeted group only', () => {
      let root = emptyGroup('AND');
      root = addGroup(root, root.id);
      const subGroupId = (root.children[0] as { id: string }).id;
      root = setGroupCombinator(root, subGroupId, 'OR');
      expect((root.children[0] as { combinator: string }).combinator).toBe('OR');
      expect(root.combinator).toBe('AND');
    });

    it('updateCondition patches only the targeted condition', () => {
      let root = emptyGroup('AND');
      root = addCondition(root, root.id);
      root = addCondition(root, root.id);
      const secondId = (root.children[1] as { id: string }).id;
      root = updateCondition(root, secondId, { field: 'level', value: 'ERROR' });
      expect(root.children[0]).toMatchObject({ field: 'service', value: '' });
      expect(root.children[1]).toMatchObject({ field: 'level', value: 'ERROR' });
    });

    it('removeNode removes a condition or a subgroup, anywhere in the tree, without touching siblings', () => {
      let root = emptyGroup('AND');
      root = addCondition(root, root.id);
      root = addGroup(root, root.id);
      const subGroupId = (root.children[1] as { id: string }).id;
      root = addCondition(root, subGroupId);
      const nestedConditionId = (root.children[1] as { children: { id: string }[] }).children[0].id;

      const afterRemovingNested = removeNode(root, nestedConditionId);
      expect((afterRemovingNested.children[1] as { children: unknown[] }).children).toHaveLength(0);
      expect(afterRemovingNested.children[0]).toEqual(root.children[0]); // sibling untouched

      const afterRemovingSubgroup = removeNode(root, subGroupId);
      expect(afterRemovingSubgroup.children).toHaveLength(1);
    });
  });

  describe('hasAnyCondition', () => {
    it('is false for an empty group tree', () => {
      expect(hasAnyCondition(emptyGroup())).toBe(false);
    });

    it('is true once any condition exists, even nested inside an otherwise-empty subgroup', () => {
      let root = emptyGroup('AND');
      root = addGroup(root, root.id);
      const subGroupId = (root.children[0] as { id: string }).id;
      root = addCondition(root, subGroupId);
      expect(hasAnyCondition(root)).toBe(true);
    });
  });

  describe('emptyCondition', () => {
    it('generates a stable, non-empty id for React keys', () => {
      const a = emptyCondition();
      const b = emptyCondition();
      expect(a.id).not.toBe(b.id);
      expect(a.id).toBeTruthy();
    });
  });
});
