const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// CONFIGURACIÓN DE BASE DE DATOS - Corregido a localhost
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',      
    password: 'root',      
    database: 'sistema_maquinas' 
});

db.connect((err) => {
    if (err) {
        console.error('Error conectando a la BD Local:', err);
    } else {
        console.log('Conectado exitosamente a MySQL en Localhost');
    }
});

// --- RUTAS API ---

app.post('/api/login', (req, res) => {
    const { usuario, clave } = req.body;
    db.query("SELECT * FROM usuario WHERE usuario = ? AND clave = ?", [usuario, clave], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length > 0) {
            const user = { ...results[0] };
            delete user.clave;
            res.json({ success: true, user });
        } else {
            res.status(401).json({ success: false, message: "Incorrecto" });
        }
    });
});

app.get('/api/validar/:tabla/:campo/:valor', (req, res) => {
    const { tabla, campo, valor } = req.params;
    const { excludeId } = req.query;
    let sql = `SELECT id FROM ${tabla} WHERE ${campo} = ?`;
    let params = [valor];
    if (excludeId && excludeId !== 'null') { sql += " AND id != ?"; params.push(excludeId); }
    sql += " LIMIT 1";
    db.query(sql, params, (err, results) => res.json({ existe: results.length > 0 }));
});

app.get('/api/permisos_sucursal/:id', (req, res) => {
    db.query("SELECT sucursal_id FROM usuario_sucursal WHERE usuario_id = ?", [req.params.id], (err, results) => {
        res.json(results.map(r => r.sucursal_id));
    });
});

app.post('/api/asignar_sucursales', (req, res) => {
    const { usuario_id, sucursales } = req.body; 
    db.query("DELETE FROM usuario_sucursal WHERE usuario_id = ?", [usuario_id], (err) => {
        if (err) return res.status(500).send("Error limpiar");
        if (!sucursales || sucursales.length === 0) return res.json({ message: "Permisos eliminados." });
        const values = sucursales.map(sid => [usuario_id, sid]);
        db.query("INSERT INTO usuario_sucursal (usuario_id, sucursal_id) VALUES ?", [values], (err) => {
            if (err) return res.status(500).send("Error guardar");
            res.json({ message: "Guardado" });
        });
    });
});

app.get('/api/options/:tabla', (req, res) => {
    const { tabla } = req.params;
    const { userId } = req.query; 
    let sql = `SELECT * FROM ${tabla} ORDER BY nombre`;
    if (tabla === 'sucursal') {
        if (userId) {
            sql = `SELECT s.id, s.nombre, g.nombre as parent_nom FROM sucursal s LEFT JOIN grupo g ON s.grupo_id = g.id INNER JOIN usuario_sucursal us ON s.id = us.sucursal_id WHERE us.usuario_id = ${mysql.escape(userId)} ORDER BY g.nombre, s.nombre`;
        } else {
            sql = `SELECT s.id, s.nombre, g.nombre as parent_nom FROM sucursal s LEFT JOIN grupo g ON s.grupo_id = g.id ORDER BY g.nombre, s.nombre`;
        }
    }
    if (tabla === 'modelo') {
        sql = `SELECT m.id, m.nombre, ma.nombre as parent_nom FROM modelo m LEFT JOIN marca ma ON m.marca_id = ma.id ORDER BY ma.nombre, m.nombre`;
    }
    db.query(sql, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.get('/api/:tabla', (req, res) => {
    const { tabla } = req.params;
    const { userId } = req.query;
    let sql = "";
    if (tabla === 'maquina') {
        sql = `SELECT m.*, g.nombre as grupo_nom, s.nombre as sala_nom, ma.nombre as marca_nom, mo.nombre as modelo_nom, j.nombre as juego_nom, e.nombre as estado_nom, so.nombre as sociedad_nom, v.nombre as valor_nom FROM maquina m LEFT JOIN sucursal s ON m.sucursal_id = s.id LEFT JOIN grupo g ON s.grupo_id = g.id LEFT JOIN modelo mo ON m.modelo_id = mo.id LEFT JOIN marca ma ON mo.marca_id = ma.id LEFT JOIN juego j ON m.juego_id = j.id LEFT JOIN estado e ON m.estado_id = e.id LEFT JOIN sociedad so ON m.sociedad_id = so.id LEFT JOIN valor v ON m.valor_id = v.id`;
        if (userId) { sql += ` INNER JOIN usuario_sucursal us ON m.sucursal_id = us.sucursal_id WHERE us.usuario_id = ${mysql.escape(userId)}`; }
    } else if (tabla === 'sucursal') {
        sql = "SELECT s.*, g.nombre as grupo_nom FROM sucursal s LEFT JOIN grupo g ON s.grupo_id = g.id";
    } else if (tabla === 'modelo') { 
        sql = "SELECT m.*, ma.nombre as marca_nom FROM modelo m LEFT JOIN marca ma ON m.marca_id = ma.id";
    } else {
        sql = `SELECT * FROM ${tabla}`;
    }
    db.query(sql, (err, results) => {
        if (err) return res.status(500).send(err.message);
        res.json(results);
    });
});

app.get('/api/:tabla/:id', (req, res) => {
    const { tabla, id } = req.params;
    db.query(`SELECT * FROM ${tabla} WHERE id = ?`, [id], (err, results) => res.json(results[0]));
});

app.post('/api/:tabla', (req, res) => {
    const { tabla } = req.params;
    const data = req.body;
    db.query(`INSERT INTO ${tabla} SET ?`, data, (err, result) => {
        if (err) return res.status(500).send(err.message);
        res.json({ id: result.insertId, ...data });
    });
});

app.put('/api/:tabla/:id', (req, res) => {
    const { tabla, id } = req.params;
    const data = req.body;
    db.query(`UPDATE ${tabla} SET ? WHERE id = ?`, [data, id], (err) => {
        if (err) return res.status(500).send(err.message);
        res.json({ success: true });
    });
});

app.delete('/api/:tabla/:id', (req, res) => {
    const { tabla, id } = req.params;
    db.query(`DELETE FROM ${tabla} WHERE id = ?`, [id], (err) => {
        if (err && err.errno === 1451) return res.status(409).json({ message: "Registro asociado, no se puede borrar." });
        if (err) return res.status(500).send(err.message);
        res.json({ success: true });
    });
});

app.listen(3001, () => console.log('Servidor corriendo en puerto 3001'));