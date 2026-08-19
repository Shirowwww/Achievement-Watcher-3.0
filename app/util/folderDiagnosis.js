'use strict';

/*
  Turns a userDir.diagnose() verdict into the sentence shown when a folder the user picked is
  refused.

  The report behind issue #32 asked for exactly this: "an explicit reason surfaced in the app when a
  game folder is examined and rejected, so it is possible to tell 'nothing found here' from 'not
  looked at'". A single "invalid folder" message answers neither question - it reads as a dead end
  whether AW searched the folder thoroughly or never understood the layout at all.

  Kept out of the UI files so both the Settings panel and the first-run guide phrase it identically,
  and so it can be tested without Electron. `translate` is locale/t.js's t(key, english, french).
*/

function joinList(values, limit = 5) {
  return values
    .filter(Boolean)
    .slice(0, limit)
    .map((value) => String(value).replace(/\\/g, '/'))
    .join(', ');
}

function describeFolderDiagnosis(diagnosis, translate) {
  const t = typeof translate === 'function' ? translate : (key, english) => english;
  const code = diagnosis && diagnosis.code;
  const evidence = (diagnosis && diagnosis.evidence) || {};
  const lines = [];

  if (code === 'ea-app-release') {
    lines.push(
      t(
        'folder-reason-ea-app',
        'This is an EA app release. A game started through the EA app keeps its achievements on the EA account rather than in the game folder, so there is no unlock file here to read. Those unlocks are picked up by the EA source in Settings > Sources instead of by a watched folder.',
        "Il s'agit d'une version EA app. Un jeu lancé via l'EA app conserve ses succès sur le compte EA et non dans le dossier du jeu : il n'y a donc ici aucun fichier de déblocage à lire. Ces succès sont récupérés par la source EA dans Paramètres > Sources, pas par un dossier surveillé."
      )
    );
  } else if (code === 'game-folder-no-data') {
    lines.push(
      t(
        'folder-reason-game-no-data',
        'This is a game folder, but it holds no emulator configuration and no unlock file in any layout AW Next can read.',
        "Il s'agit bien d'un dossier de jeu, mais il ne contient aucune configuration d'émulateur ni fichier de déblocage dans un format lisible par AW Next."
      )
    );
  } else if (code === 'unreadable') {
    lines.push(
      t('folder-reason-unreadable', 'This folder could not be read.', "Ce dossier n'a pas pu être lu.") +
        (evidence.error ? ` (${evidence.error})` : '')
    );
  } else {
    lines.push(
      t(
        'folder-reason-no-marker',
        'Nothing achievement related is stored here: no AppID folder, no emulator configuration and no unlock file.',
        "Rien de lié aux succès n'est stocké ici : aucun dossier AppID, aucune configuration d'émulateur et aucun fichier de déblocage."
      )
    );
  }

  const foundInstead = joinList(evidence.markers || (evidence.executable ? [evidence.executable] : []));
  if (foundInstead) {
    lines.push(`${t('folder-reason-found-instead', 'Found instead:', 'Trouvé à la place :')} ${foundInstead}`);
  }

  lines.push(
    t(
      'folder-reason-checked',
      'Checked here: AppID subfolders, every emulator configuration file AW Next knows, and {layouts} portable save layouts. The folder was examined - nothing was skipped.',
      "Vérifié ici : les sous-dossiers AppID, tous les fichiers de configuration d'émulateur connus d'AW Next et {layouts} dispositions de sauvegarde portables. Le dossier a bien été examiné, rien n'a été ignoré."
    ).replace('{layouts}', String(evidence.layouts || 0))
  );

  return lines.join('\n\n');
}

module.exports = { describeFolderDiagnosis };
