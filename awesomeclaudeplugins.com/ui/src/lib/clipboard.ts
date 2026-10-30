export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    let textarea: HTMLTextAreaElement | undefined
    try {
      textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.append(textarea)
      textarea.select()
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      textarea?.remove()
    }
  }
}
