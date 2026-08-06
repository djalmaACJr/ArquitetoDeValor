// src/lib/biometria.ts
//
// Login por biometria (digital/Face) no app Android — wrapper fino sobre
// @capgo/capacitor-native-biometric.
//
// Como funciona: o Supabase não tem um provedor de auth biométrico nativo
// (a digital nunca é enviada ao servidor). O padrão usado aqui — igual a
// apps bancários — é: 1) `verifyIdentity()` mostra o prompt nativo de
// biometria; só prosseguimos se o usuário confirmar. 2) e-mail+senha ficam
// guardados criptografados em repouso (EncryptedSharedPreferences no
// Android) via `setCredentials()`/`getCredentials()`.
//
// HISTÓRICO (2026-08-05): a 1ª versão usava `accessControl:
// BIOMETRY_CURRENT_SET`/`BIOMETRY_ANY` — vincula a própria chave do Keystore
// à biometria (o SO só libera a chave depois de um BiometricPrompt bem-
// sucedido, sem o app precisar chamar verifyIdentity à parte). Em teste
// real, `setCredentials` com qualquer um dos dois falhava com
// "Failed to encrypt credentials: null" — bug/incompatibilidade do plugin
// nessa combinação de aparelho/Android com o caminho de crypto vinculado ao
// Keystore. Trocado para o padrão mais simples acima (verifyIdentity +
// storage criptografado sem vínculo de hardware): perde a garantia extra de
// "SO nunca libera a chave sem biometria", mas a biometria continua sendo
// exigida em toda ativação/leitura pelo app, e funciona de fato.
//
// Só roda em Android/iOS nativo (Capacitor.isNativePlatform()) — no browser
// todas as funções abaixo são no-op/retornam indisponível.
//
// IMPORTANTE: isso troca o SEGREDO guardado (auto-logout chama signOut()
// global, que não invalida a senha em si) — ao contrário de guardar um
// refresh token, a digital sempre consegue reautenticar do zero mesmo depois
// do logout por inatividade ou de um signOut manual, que é o comportamento
// pedido: "entrar com a digital", não só destravar uma sessão ainda viva.

import { Capacitor } from '@capacitor/core'
import { NativeBiometric, BiometricAuthError } from '@capgo/capacitor-native-biometric'

// Server/namespace da credencial — usa o appId (capacitor.config.ts) para
// não colidir com credenciais de outro app que porventura use o mesmo plugin.
const SERVER = 'br.com.arquitetodevalor.app'

const NATIVO = Capacitor.isNativePlatform()

export interface DisponibilidadeBiometria {
  disponivel: boolean
  motivo?: 'sem-hardware' | 'nao-cadastrada' | 'sem-bloqueio-tela' | 'outro'
}

/** Hardware/enrolamento de biometria disponível NESTE aparelho (não diz se o usuário já ativou no app). */
export async function biometriaDisponivelNoAparelho(): Promise<DisponibilidadeBiometria> {
  if (!NATIVO) return { disponivel: false, motivo: 'outro' }
  try {
    const r = await NativeBiometric.isAvailable({ useFallback: false })
    if (r.isAvailable) return { disponivel: true }
    const motivo =
      r.errorCode === BiometricAuthError.BIOMETRICS_NOT_ENROLLED ? 'nao-cadastrada' :
      r.errorCode === BiometricAuthError.PASSCODE_NOT_SET        ? 'sem-bloqueio-tela' :
      r.errorCode === BiometricAuthError.BIOMETRICS_UNAVAILABLE  ? 'sem-hardware' : 'outro'
    return { disponivel: false, motivo }
  } catch {
    return { disponivel: false, motivo: 'outro' }
  }
}

/** O usuário já ativou "entrar com digital" neste app (credenciais salvas)? */
export async function biometriaAtiva(): Promise<boolean> {
  if (!NATIVO) return false
  try {
    const r = await NativeBiometric.isCredentialsSaved({ server: SERVER })
    return r.isSaved
  } catch {
    return false
  }
}

/**
 * Ativa o login por digital: pede confirmação biométrica (verifyIdentity) e,
 * só depois, guarda e-mail+senha criptografados em repouso. Chame logo após
 * um login manual bem-sucedido, com a senha ainda em mãos (nunca é mantida
 * em memória fora desse momento).
 */
export async function ativarBiometria(email: string, senha: string): Promise<{ ok: boolean; erro?: string }> {
  if (!NATIVO) return { ok: false, erro: 'Disponível apenas no app Android.' }
  try {
    await NativeBiometric.verifyIdentity({
      reason: 'Confirme sua digital para ativar o login rápido',
      title: 'Ativar login por digital',
    })
    await NativeBiometric.setCredentials({
      server: SERVER,
      username: email,
      password: senha,
      // accessControl omitido = AccessControl.NONE (padrão do plugin): grava
      // criptografado em repouso, sem vincular a chave à biometria no
      // Keystore — ver histórico no topo do arquivo. A biometria já foi
      // exigida acima (verifyIdentity) antes de chegar aqui.
    })
    return { ok: true }
  } catch (e) {
    // console.error fica ativo em produção (lib/logger.ts só faz no-op de
    // log/debug/info) — é o único jeito de ver a causa real no Logcat sem
    // instrumentação extra, já que quem chama isso mostra só uma mensagem
    // curta pro usuário.
    console.error('[biometria] falha ao ativar', e)
    return { ok: false, erro: (e as Error)?.message ?? 'Não foi possível ativar a digital.' }
  }
}

/** Desativa o login por digital, apagando as credenciais salvas. */
export async function desativarBiometria(): Promise<void> {
  if (!NATIVO) return
  try { await NativeBiometric.deleteCredentials({ server: SERVER }) } catch { /* nada salvo — ok */ }
}

/**
 * Pede a digital e devolve e-mail+senha salvos para o chamador terminar o
 * login (supabase.auth.signInWithPassword). Lança erro se o usuário cancelar,
 * errar a biometria demais vezes, ou não houver credenciais salvas.
 */
export async function entrarComBiometria(): Promise<{ email: string; senha: string }> {
  if (!NATIVO) throw new Error('Disponível apenas no app Android.')
  try {
    await NativeBiometric.verifyIdentity({
      reason: 'Confirme sua digital para entrar',
      title: 'Entrar com digital',
    })
    const cred = await NativeBiometric.getCredentials({ server: SERVER })
    return { email: cred.username, senha: cred.password }
  } catch (e) {
    console.error('[biometria] falha ao ler credenciais', e)
    throw e
  }
}
