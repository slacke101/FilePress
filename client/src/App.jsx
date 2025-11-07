import { useState, useEffect, useRef } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import React from 'react';

export default function App() {
  const [files, setFiles] = useState([]);
  const [openRows, setOpenRows] = useState({});
  const [lastDeleted, setLastDeleted] = useState(null);
  const [msg, setMsg] = useState('');
  const dzRef = useRef(null);
  const fileInputRef = useRef(null);
  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  if (!token) {
    window.location = 'http://localhost:5000/login';
    return null;
  }

  const fetchFiles = async () => {
    try {
      const r = await fetch('/files', { headers });
      const d = await r.json();
      if (r.ok) setFiles(d); else throw new Error(d.error || 'Fetch failed');
    } catch (e) {
      setMsg(e.message);
    }
  };

  useEffect(() => {
    fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = async file => {
    const fd = new FormData(); fd.append('file', file);
    const r = await fetch('/upload', { method: 'POST', headers, body: fd });
    const d = await r.json();
    if (r.ok) { setMsg(`Uploaded ${d.filename}`); fetchFiles(); }
    else setMsg(d.error || 'Upload failed');
  };

  const onFileChange = e => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  useEffect(() => {
    const dz = dzRef.current;
    const stop = e => { e.preventDefault(); e.stopPropagation(); };
    const over = e => { stop(e); dz.classList.add('border-primary'); };
    const leave = () => dz.classList.remove('border-primary');

    const drop = async e => {
      stop(e); dz.classList.remove('border-primary');
      const f = e.dataTransfer.files[0];
      if (!f) return;
      handleFile(f);
    };

    const click = () => fileInputRef.current.click();

    dz.addEventListener('dragover', over);
    dz.addEventListener('dragleave', leave);
    dz.addEventListener('drop', drop);
    dz.addEventListener('click', click);
    return () => {
      dz.removeEventListener('dragover', over);
      dz.removeEventListener('dragleave', leave);
      dz.removeEventListener('drop', drop);
      dz.removeEventListener('click', click);
    };
  }, []);

  const [busy, setBusy] = useState(null); // filename that is converting
  const [showTip, setShowTip] = useState(localStorage.getItem('dismissTip')!=='1');

  const convert = async fn => {
    setBusy(fn);
    setMsg(`Converting ${fn} …`);
    const r = await fetch(`/convert/${fn}`, { method: 'POST', headers });
    const d = await r.json();
    if (r.ok && d.download_url) {
      await downloadFile(d.download_url, fn.replace(/\.(png|jpg|jpeg)$/i, '.pdf'));
      setMsg('Conversion complete');
    } else setMsg(d.error || 'Conversion failed');
    setBusy(null);
  };

  const pendingRef = useRef({});

  const remove = async fn => {
    if (!confirm(`Delete ${fn}?`)) return;
    // Optimistic UI: hide row
    setFiles(f => f.filter(x => x.filename !== fn));
    setLastDeleted(fn);
    const toast = bootstrap.Toast.getOrCreateInstance(document.getElementById('undoToast'));
    toast.show();

    // Start 5-second timer before real delete
    pendingRef.current[fn] = setTimeout(async () => {
      const r = await fetch(`/files/${fn}`, { method: 'DELETE', headers });
      if (!r.ok) setMsg('Delete failed');
      delete pendingRef.current[fn];
    }, 5000);
  };

  const undoDelete = () => {
    if (!lastDeleted) return;
    clearTimeout(pendingRef.current[lastDeleted]);
    setLastDeleted(null);
    fetchFiles();
  };

  const downloadFile = async (url, suggestedName) => {
    try {
      const res = await fetch(url, { headers });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setMsg('Download failed');
    }
  };

  return (
    <>
      <nav className="navbar navbar-light bg-white shadow-sm px-3">
        <span className="navbar-brand fw-bold text-primary">FilePress</span>
        <div className="d-flex align-items-center gap-2">
          <button id="themeBtn" type="button" className="btn btn-sm btn-outline-secondary" title="Toggle dark mode" aria-label="Toggle dark mode" onClick={() => {
            const html=document.documentElement;
            const newTheme = html.dataset.bsTheme==='dark'? 'light':'dark';
            html.dataset.bsTheme = newTheme;
            localStorage.setItem('theme', newTheme);
            document.getElementById('themeBtn').innerHTML = newTheme==='dark'? '<i class="bi bi-sun"></i>' : '<i class="bi bi-moon"></i>';
          }}><i className="bi bi-moon"></i></button>
          <button className="btn btn-sm btn-outline-primary" onClick={() => { localStorage.removeItem('token'); location = '/'; }}>Logout</button>
        </div>
      </nav>

      {showTip && (
        <div className="container mt-3">
          <div className="alert alert-info alert-dismissible fade show" role="alert">
            <strong>Tip:</strong> Drag & drop files here or click the box to browse.  Convert images to PDF with one click!
            <button type="button" className="btn-close" onClick={()=>{localStorage.setItem('dismissTip','1'); setShowTip(false);}} aria-label="Close"></button>
          </div>
        </div>) }

      <div className="container my-4">
      <div
        ref={dzRef}
        className="border border-2 border-secondary rounded d-flex flex-column justify-content-center align-items-center mx-auto p-4"
        style={{ maxWidth: 450, height: 220, cursor: 'pointer' }}>
        <p className="text-muted mb-0 text-center">Drag & Drop or Click to Browse</p>
        <input type="file" ref={fileInputRef} onChange={onFileChange} style={{ display: 'none' }} />
      </div>

      {msg && <p className="text-center mt-2">{msg}</p>}

      <div className="card shadow-sm mt-4">
      <div className="table-responsive">
        <table className="table table-hover mb-0">
          <thead><tr><th>Name</th><th>Size KB</th><th>Type</th><th>Pages</th><th className="text-end">Actions</th></tr></thead>
          <tbody>
            {files.map(f => (
              <React.Fragment key={f.filename}>
                <tr>
                  <td>
                    <i className={`bi ${openRows[f.filename]?'bi-chevron-down':'bi-chevron-right'} me-1`}
                       style={{cursor:'pointer'}}
                       onClick={()=>setOpenRows(o=>({...o,[f.filename]:!o[f.filename]}))}></i>
                    {f.filename}
                  </td>
                  <td>{(f.size / 1024).toFixed(1)}</td>
                  <td>{f.mimetype}</td>
                  <td>{f.pages ?? '—'}</td>
                  <td className="d-flex gap-2 justify-content-end">
                    {f.mimetype.includes('pdf') ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <button title="Convert to PDF" className="btn btn-sm btn-primary" disabled={busy===f.filename} onClick={() => convert(f.filename)}>
                        {busy===f.filename ? (
                          <span className="spinner-border spinner-border-sm"></span>
                        ) : (<i className="bi bi-file-earmark-pdf"></i>)}
                      </button>
                    )}
                    <button title="Delete file" className="btn btn-sm btn-outline-danger" onClick={() => remove(f.filename)}>
                      <i className="bi bi-trash"></i>
                    </button>
                  </td>
                </tr>
                {openRows[f.filename] && (
                  <tr className="table-light">
                    <td colSpan="5">
                      Size: {(f.size/1024).toFixed(1)} KB | Type: {f.mimetype}
                      {f.pages?` | Pages: ${f.pages}`:''}
                      {f.docinfo && Object.keys(f.docinfo).length>0 && (
                        <> | Metadata: {Object.entries(f.docinfo).map(([k,v])=>`${k}: ${v}`).join(' · ')}</>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {files.length === 0 && <tr><td colSpan="4">No files yet</td></tr>}
          </tbody>
        </table>
      </div></div></div>

      <footer className="bg-light text-center py-3 mt-5 small text-muted">
        © 2025 FilePress. Convert and manage your files with ease.
      </footer>

      {/* Undo toast */}
      <div className="position-fixed top-0 end-0 p-3" style={{zIndex:11}}>
        <div id="undoToast" className="toast align-items-center text-bg-secondary" role="alert" aria-live="assertive" aria-atomic="true">
          <div className="d-flex">
            <div className="toast-body">
              File deleted. <button className="btn btn-link btn-sm p-0 text-white" onClick={undoDelete}>Undo</button>
            </div>
            <button type="button" className="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
          </div>
        </div>
      </div>

      {/* First-time modal */}
      <div className="modal fade" id="welcomeModal" tabIndex="-1" aria-hidden="true">
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header"><h5 className="modal-title">Welcome to FilePress</h5></div>
            <div className="modal-body">
              <ol>
                <li>Login with your credentials.</li>
                <li>Upload files via Drag & Drop or Click.</li>
                <li>Convert images to PDF or manage your files.</li>
              </ol>
              <p className="mb-0">Happy converting!</p>
            </div>
            <div className="modal-footer"><button className="btn btn-primary" data-bs-dismiss="modal">Get started</button></div>
          </div>
        </div>
      </div>
    </>
  );
}

