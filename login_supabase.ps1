# login_supabase.ps1
$Headers = @{
    "apikey" = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzaWNpcGlqb25sZHVjbWNqZ3R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwMDE1NDAsImV4cCI6MjA3NTU3NzU0MH0.9glpncQKFKyWiVBq79g5kmuNOcRzHtMkHEXxxbOB6uM"
    "Content-Type" = "application/json"
}

$Body = @{
    email = "seu_email@exemplo.com"
    password = "sua_senha_aqui"
} | ConvertTo-Json

$Url = "https://ssicipijonldumcjgrty.supabase.co/auth/v1/token?grant_type=password"

$Response = Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers -Body $Body
$Response | ConvertTo-Json -Depth 5
