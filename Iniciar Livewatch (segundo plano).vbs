' Sobe o Livewatch sem janela de terminal e abre o painel no navegador.
' Para desligar depois, use o "Parar Livewatch.bat".

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

pasta = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = pasta

If Not fso.FolderExists(pasta & "\node_modules") Then
  MsgBox "Primeira execucao detectada." & vbCrLf & vbCrLf & _
         "Rode o ""Iniciar Livewatch.bat"" uma vez para instalar as dependencias." & vbCrLf & _
         "Depois disso este atalho funciona normalmente.", 48, "Metropole Livewatch"
  WScript.Quit
End If

shell.Run "cmd /c node server.js", 0, False
WScript.Sleep 3000
shell.Run "http://localhost:3000", 1, False
