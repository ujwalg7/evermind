import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { parseHtml } from '../src/extractor';
import { formatNoteMarkdown } from '../src/vault';
import { localizeImages } from '../src/images';
import { CanonicalNote } from '../src/types';

describe('Article-to-Obsidian Pipeline Tests', () => {
  const fixturesDir = path.join(__dirname, 'fixtures');

  // Test 1: Deterministic Article Parsing
  it('should parse a standard article fixture with high confidence and clean structure', () => {
    const htmlPath = path.join(fixturesDir, 'simple-article.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    
    const note = parseHtml(html, 'https://example.com/article.html', 0.6);

    // Metadata validation
    assert.strictEqual(note.title, 'Simple Mock Article');
    assert.strictEqual(note.author, 'John Doe');
    assert.strictEqual(note.publishedDate, '2026-05-26');
    assert.strictEqual(note.heroImageUrl, 'https://example.com/hero.jpg');
    assert.ok(note.confidenceScore > 0.6);
    assert.strictEqual(note.captureStatus, 'complete');
    assert.ok(note.fingerprint.length > 0);

    // Structure preservation validation
    // Code blocks with language
    assert.ok(note.contentMarkdown.includes('```js'));
    assert.ok(note.contentMarkdown.includes("const test = () => { console.log('hello'); };"));
    
    // Blockquotes
    assert.ok(note.contentMarkdown.includes('> "This is a blockquote that must be formatted correctly in Markdown."'));
    
    // Figcaptions
    assert.ok(note.contentMarkdown.includes('*Caption: Figure 1: Main block architecture*'));
    
    // Headings
    assert.ok(note.headings.includes('Test Subheading'));
  });

  // Test 2: Heuristic Paywall/Cookie Wall Quality Gate
  it('should flag paywalls/cookie walls and force confidence to 0 (partial capture)', () => {
    const htmlPath = path.join(fixturesDir, 'paywall-cookie.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    
    const note = parseHtml(html, 'https://example.com/paywall-page', 0.6);

    assert.strictEqual(note.confidenceScore, 0);
    assert.strictEqual(note.captureStatus, 'partial');
  });

  // Test 3: Provenance Metadata Formatting
  it('should serialize comprehensive YAML frontmatter provenance', () => {
    const mockNote: CanonicalNote = {
      title: 'Test Provenance Title',
      sourceUrl: 'https://example.com/source',
      author: 'Test Author',
      publishedDate: '2026-05-25',
      contentMarkdown: 'Mock Content Body.',
      headings: ['Test Header'],
      images: [
        { originalUrl: 'https://example.com/img1.jpg', localPath: 'attachments/evermind/img1.jpg', status: 'downloaded' },
        { originalUrl: 'https://example.com/img2.jpg', status: 'failed' }
      ],
      confidenceScore: 0.95,
      captureStatus: 'complete',
      fingerprint: 'sha256-mockhash123'
    };

    const formatted = formatNoteMarkdown(mockNote);
    
    // Ensure all metadata fields are present
    assert.ok(formatted.includes('title: "Test Provenance Title"'));
    assert.ok(formatted.includes('source: "https://example.com/source"'));
    assert.ok(formatted.includes('author: "Test Author"'));
    assert.ok(formatted.includes('published: "2026-05-25"'));
    assert.ok(formatted.includes('extraction_tier: 2'));
    assert.ok(formatted.includes('confidence: 0.95'));
    assert.ok(formatted.includes('capture_status: "complete"'));
    assert.ok(formatted.includes('fingerprint: "sha256-mockhash123"'));
    
    // Ensure images statuses are logged
    assert.ok(formatted.includes('  - url: "https://example.com/img1.jpg"'));
    assert.ok(formatted.includes('    path: "attachments/evermind/img1.jpg"'));
    assert.ok(formatted.includes('    status: "downloaded"'));
    assert.ok(formatted.includes('  - url: "https://example.com/img2.jpg"'));
    assert.ok(formatted.includes('    status: "failed"'));
  });

  // Test 4: Capture-oriented Image Localization Failure Path
  it('should preserve original image URL in markdown body if downloading fails', async () => {
    const mockNote: CanonicalNote = {
      title: 'Note with Broken Image',
      sourceUrl: 'https://example.com/page',
      contentMarkdown: 'Broken image link here: ![Alt Image](https://invalid-domain.xyz/nonexistent.jpg)',
      headings: [],
      images: [{ originalUrl: 'https://invalid-domain.xyz/nonexistent.jpg', status: 'skipped' }],
      confidenceScore: 1.0,
      captureStatus: 'complete',
      fingerprint: 'mockfingerprint'
    };

    const localized = await localizeImages(
      mockNote,
      path.join(__dirname, 'mock_vault'),
      'attachments/evermind'
    );

    // Ensure status is marked as failed
    assert.strictEqual(localized.images[0].status, 'failed');
    
    // Ensure contentMarkdown was NOT broken and still contains original remote URL
    assert.ok(localized.contentMarkdown.includes('![Alt Image](https://invalid-domain.xyz/nonexistent.jpg)'));
    
    // Cleanup mock folders if created
    const mockVaultPath = path.join(__dirname, 'mock_vault');
    if (fs.existsSync(mockVaultPath)) {
      fs.rmSync(mockVaultPath, { recursive: true, force: true });
    }
  });
});
