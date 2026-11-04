import { Capacitor } from '@capacitor/core'

function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload  = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/**
 * Entrega um arquivo gerado no cliente ao usuário.
 * - Web/desktop: download via <a download>.
 * - Android (WebView): `<a download>` com blob: não faz nada, então grava o
 *   arquivo no cache do app e abre a folha de compartilhamento do sistema
 *   (salvar em Arquivos/Drive, enviar por WhatsApp/e-mail…).
 */
export async function baixarArquivo(blob: Blob, nome: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])
    const { uri } = await Filesystem.writeFile({
      path: nome,
      data: await blobParaBase64(blob),
      directory: Directory.Cache,
    })
    await Share.share({ title: nome, files: [uri], dialogTitle: 'Salvar ou enviar arquivo' })
    return
  }
  const url = URL.createObjectURL(blob)
  const a   = Object.assign(document.createElement('a'), { href: url, download: nome })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
