import type { AuthError } from '@supabase/supabase-js'

// Traduz erros do Supabase Auth (que vêm em inglês) para mensagens em português.
// Usa `code` quando existe (formato novo do GoTrue) e cai para o texto da
// mensagem como fallback (formato antigo / erros sem code).
export function traduzirErroAuth(err: Pick<AuthError, 'message'> & { code?: string }): string {
  const msg = (err.message ?? '').toLowerCase()

  switch (err.code) {
    case 'weak_password':
      return 'Senha fraca ou muito comum. Escolha uma senha mais difícil de adivinhar (misture letras, números e símbolos).'
    case 'user_already_exists':
    case 'email_exists':
      return 'Este e-mail já está cadastrado.'
    case 'same_password':
      return 'A nova senha deve ser diferente da senha atual.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
    case 'over_sms_send_rate_limit':
      return 'Muitas tentativas seguidas. Aguarde um instante e tente novamente.'
    case 'email_address_invalid':
    case 'validation_failed':
      return 'E-mail inválido. Verifique o endereço digitado.'
    case 'signup_disabled':
      return 'Novos cadastros estão desativados no momento.'
    case 'session_expired':
    case 'session_not_found':
    case 'refresh_token_not_found':
      return 'Sessão expirada. Entre novamente.'
    case 'user_banned':
      return 'Esta conta está bloqueada. Entre em contato com o suporte.'
    case 'email_not_confirmed':
      return 'Confirme seu e-mail antes de entrar — verifique sua caixa de entrada.'
    case 'invalid_credentials':
      return 'E-mail ou senha inválidos.'
  }

  if (msg.includes('known to be weak') || msg.includes('weak and easy to guess'))
    return 'Senha fraca ou muito comum. Escolha uma senha mais difícil de adivinhar (misture letras, números e símbolos).'
  if (msg.includes('already registered') || msg.includes('already been registered'))
    return 'Este e-mail já está cadastrado.'
  if (msg.includes('different from the old password'))
    return 'A nova senha deve ser diferente da senha atual.'
  if (msg.includes('at least') && msg.includes('characters'))
    return 'A senha é muito curta. Use pelo menos 6 caracteres.'
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('security purposes'))
    return 'Muitas tentativas seguidas. Aguarde um instante e tente novamente.'
  if (msg.includes('invalid email') || msg.includes('unable to validate email'))
    return 'E-mail inválido. Verifique o endereço digitado.'
  if (msg.includes('signups not allowed') || msg.includes('signup is disabled'))
    return 'Novos cadastros estão desativados no momento.'
  if (msg.includes('session') && (msg.includes('missing') || msg.includes('expired')))
    return 'Sessão expirada. Entre novamente.'
  if (msg.includes('failed to fetch') || msg.includes('network'))
    return 'Falha de conexão. Verifique sua internet e tente novamente.'

  return 'Ocorreu um erro inesperado. Tente novamente em instantes.'
}
