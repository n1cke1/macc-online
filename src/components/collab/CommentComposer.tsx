'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

export default function CommentComposer({
  onSubmit,
  placeholder,
  compact,
}: {
  onSubmit: (body: string) => Promise<void>;
  placeholder?: string;
  compact?: boolean;
}) {
  const t = useTranslations('collab');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(text);
      setBody('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder ?? t('composerPlaceholder')}
        rows={compact ? 2 : 3}
        className="w-full resize-y rounded-md border border-line px-2 py-1.5 text-sm"
      />
      <div className="flex items-center justify-between gap-2">
        {err ? <span className="text-xs text-red-600">{err}</span> : <span />}
        <button
          onClick={() => void submit()}
          disabled={busy || !body.trim()}
          className="rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-40"
        >
          {busy ? t('posting') : t('post')}
        </button>
      </div>
    </div>
  );
}
