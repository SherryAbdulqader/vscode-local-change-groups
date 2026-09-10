import * as vscode from 'vscode';
import { describeFileCount } from '../core/text';
import { applyAutoAssign, AutoAssignContext, currentAutoAssignRules } from '../services/autoAssign';
import { exportLayout, importLayout, LayoutContext } from '../services/layoutActions';
import { GroupNode } from '../view/nodes';
import { CommandContext, runCommand } from './context';
import { requireRepository } from './prompts';

/**
 * The two ways of moving a whole arrangement around: rules, and files.
 *
 * Auto-assign normally runs on its own, so the command here is for when you have
 * just edited your rules and want them applied to what is already on screen.
 * Export and import are how a layout leaves your machine.
 */
export function registerLayoutCommands(context: CommandContext): vscode.Disposable[] {
  const { store, provider, gitApi, output } = context;
  const shared: AutoAssignContext & LayoutContext = { store, provider, output };

  return [
    vscode.commands.registerCommand('localChangeGroups.applyAutoAssign', () => runCommand(output, async () => {
      const rules = currentAutoAssignRules();
      if (rules.length === 0) {
        void vscode.window.showInformationMessage(
          'No auto-assign rules are set. Add some to "localChangeGroups.autoAssign" in your settings.',
          'Open Settings'
        ).then(choice => {
          if (choice === 'Open Settings') {
            void vscode.commands.executeCommand('workbench.action.openSettings', 'localChangeGroups.autoAssign');
          }
        });
        return;
      }

      // force, because you asked. The automatic pass leaves files alone once it
      // has filed them, so without this the command would look like it did
      // nothing on files you had taken back out.
      const filed = await applyAutoAssign(shared, { force: true });
      void vscode.window.showInformationMessage(filed > 0
        ? `Auto-assign filed ${describeFileCount(filed)}.`
        : 'Auto-assign found nothing new to file.');
    })),

    vscode.commands.registerCommand('localChangeGroups.exportLayout', (node?: GroupNode) => runCommand(output, async () => {
      await exportLayout(shared, requireRepository(node, gitApi));
    })),

    vscode.commands.registerCommand('localChangeGroups.importLayout', (node?: GroupNode) => runCommand(output, async () => {
      await importLayout(shared, requireRepository(node, gitApi));
    }))
  ];
}
