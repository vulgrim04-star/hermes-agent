/**
 * Téléchargement d'un fichier fabriqué dans le navigateur.
 *
 * Rien ne transite par un serveur : le classeur, le CSV ou la sauvegarde sont
 * assemblés ici et remis au navigateur. C'est ce qui permet d'exporter des
 * données bancaires sans qu'elles quittent l'appareil.
 */
export function download(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
