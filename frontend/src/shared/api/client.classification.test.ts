import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  applyClassificationImport,
  createClassificationRule,
  deleteClassificationRule,
  downloadClassificationRulesExport,
  isRulesRevisionConflict,
  previewClassificationImport,
  ruleValidationErrors,
  updateClassificationRule,
} from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('classification rules API client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('create/update send {expectedRevision, rule}; delete carries expectedRevision as a query parameter', async () => {
    const rule = { name: 'R', tags: ['t'], conditions: [] };
    await createClassificationRule(3, rule);
    await updateClassificationRule('rule/1', 4, rule);
    await deleteClassificationRule('rule-1', 5);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/settings/classification-rules');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ expectedRevision: 3, rule });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/settings/classification-rules/rule%2F1');
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ expectedRevision: 4, rule });
    expect(fetchMock.mock.calls[2][0]).toBe('/api/v1/settings/classification-rules/rule-1?expectedRevision=5');
    expect(fetchMock.mock.calls[2][1].method).toBe('DELETE');
  });

  it('import preview sends the raw file text as text/plain; apply sends JSON', async () => {
    await previewClassificationImport('{"format":"pack"}');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/settings/classification-rules/import/preview');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'text/plain' });
    expect(fetchMock.mock.calls[0][1].body).toBe('{"format":"pack"}');

    await applyClassificationImport({ packJson: '{}', mode: 'MERGE', expectedRevision: 2 });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/settings/classification-rules/import/apply');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ packJson: '{}', mode: 'MERGE', expectedRevision: 2 });
  });

  describe('export download', () => {
    let clickSpy: ReturnType<typeof vi.spyOn>;
    let downloads: string[];

    beforeEach(() => {
      downloads = [];
      fetchMock.mockImplementation(
        async () =>
          new Response('{"rules":[]}', {
            status: 200,
            headers: { 'Content-Disposition': 'attachment; filename="log-explorer-classification-pack.json"' },
          }),
      );
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pack'), revokeObjectURL: vi.fn() }));
      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(`${this.href}|${this.download}`);
      });
    });

    it('Export all calls the export URL with no ids and downloads through a temporary <a download>', async () => {
      await downloadClassificationRulesExport();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/settings/classification-rules/export');
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(downloads).toEqual(['blob:pack|log-explorer-classification-pack.json']);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pack');
      expect(document.querySelector('a[download]')).toBeNull();
    });

    it('Export selected repeats the ids parameter once per selected rule', async () => {
      await downloadClassificationRulesExport(['mw-call', 'pay-fail']);
      expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/settings/classification-rules/export?ids=mw-call&ids=pay-fail');
    });

    it('a failed export rejects with an ApiError and never clicks a download link', async () => {
      fetchMock.mockImplementation(async () => jsonResponse({ status: 503, detail: 'Storage unavailable' }, 503));
      await expect(downloadClassificationRulesExport()).rejects.toBeInstanceOf(ApiError);
      expect(clickSpy).not.toHaveBeenCalled();
    });
  });

  it('exposes the revision-conflict reason and per-path validation errors from a ProblemDetail', () => {
    const conflict = new ApiError(409, { status: 409, reason: 'RULES_REVISION_CONFLICT', currentRevision: 8 });
    const invalid = new ApiError(400, {
      status: 400,
      reason: 'RULE_INVALID',
      errors: [{ path: 'name', message: 'Name is required' }],
    });
    expect(isRulesRevisionConflict(conflict)).toBe(true);
    expect(isRulesRevisionConflict(invalid)).toBe(false);
    expect(ruleValidationErrors(invalid)).toEqual([{ path: 'name', message: 'Name is required' }]);
    expect(ruleValidationErrors(new Error('x'))).toEqual([]);
  });
});
