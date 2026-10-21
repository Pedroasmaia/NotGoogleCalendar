# Tasks Calendar para Obsidian

Plugin comunitário que mostra tarefas Markdown do [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) em uma agenda semanal interativa. Tarefas concluídas permanecem visíveis; tarefas canceladas e tarefas sem `📅` são omitidas.

## Compilar

Requer Node.js e npm. Na pasta deste projeto, execute:

```sh
chmod +x build.sh
./build.sh
```

O script instala as dependências e gera `main.js`. Para instalar no cofre, copie `main.js`, `manifest.json` e `styles.css` para:

```text
<cofre>/.obsidian/plugins/tasks-calendar/
```

Reinicie/recarregue o Obsidian e ative **Tasks Calendar** em *Configurações → Plugins da comunidade*. O plugin Tasks deve estar instalado e habilitado.

## Uso

Abra a agenda pelo ícone de calendário na barra lateral ou pela paleta de comandos (**Open Tasks Calendar**). Use as setas ou **Today** para navegar pelas semanas. Clique em um horário vazio para digitar e criar uma nova tarefa na nota diária daquele dia. O plugin usa a pasta, o formato de data e o template configurados em **Daily notes**; se a nota ainda não existir, aplica o template e acrescenta a tarefa. Sem configuração de pasta ou formato, usa `YYYY-MM-DD.md` na raiz do cofre. Arraste ou redimensione uma sessão para atualizar a linha correspondente na tarefa original. Clique em uma tarefa para abrir a nota.

Cada tarefa deve ter vencimento no formato `📅 YYYY-MM-DD`. Uma data sem hora aparece na faixa de dia inteiro. Sessões de trabalho ficam como linhas indentadas logo abaixo da tarefa, por exemplo:

```markdown
- [ ] Preparar relatório 📅 2026-10-22
  - 📅 2026-10-20 ⏰09:00 - 11:00
```

É possível registrar mais de uma sessão na mesma tarefa e em datas diferentes. A soma de todas as sessões é exibida no título da tarefa. Para associar sessões a uma tarefa existente, abra a nota e use o comando **Add work session to task under cursor**.

Os status são interpretados conforme a configuração `status.type` do Tasks: `DONE` fica visível e `CANCELLED` é ocultado. Os status personalizados são carregados de `.obsidian/plugins/obsidian-tasks-plugin/data.json`; se essa configuração não estiver disponível, o plugin usa os símbolos padrão do Tasks (`x` concluído, `-` cancelado).
