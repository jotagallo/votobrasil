export type ShareOutcome = 'shared' | 'copied' | 'failed' | 'cancelled';

/** Web Share API quando disponível; caso contrário copia o link para a área de transferência. */
export async function shareLink(data: {
  title: string;
  text: string;
  url: string;
}): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Qualquer outra falha do compartilhamento nativo cai para a cópia do link.
    }
  }
  try {
    await navigator.clipboard.writeText(data.url);
    return 'copied';
  } catch {
    return legacyCopy(data.url) ? 'copied' : 'failed';
  }
}

function legacyCopy(text: string): boolean {
  try {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    input.remove();
    return ok;
  } catch {
    return false;
  }
}
