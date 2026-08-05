import io, json, subprocess
subprocess.run(['python3','plan_data.py'],check=True)
data=io.open('data.json',encoding='utf-8').read()
tpl=io.open('plan3d.tpl.html',encoding='utf-8').read()
assert '/*__DATA__*/{}' in tpl, 'placeholder introuvable'
out=tpl.replace('/*__DATA__*/{}', data)
io.open('plan3d.html','w',encoding='utf-8').write(out)
print('build ok — %d ko' % (len(out)//1024))
