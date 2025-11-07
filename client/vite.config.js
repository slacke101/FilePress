import react from '@vitejs/plugin-react';

export default {
  plugins: [react()],
  server: {
    proxy: {
      '/api':     'http://localhost:5000',
      '/upload':  'http://localhost:5000',
      '/files':   'http://localhost:5000',
      '/convert': 'http://localhost:5000',
      '/parse':   'http://localhost:5000'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
};
