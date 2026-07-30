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
app.get('/shared-s', (req, res) => {
    res.sendFile(path.join(__dirname, 'shared-s.html'));
});
app.get('/shared-d', (req, res) => {
    res.sendFile(path.join(__dirname, 'shared-d.html'));
});

// CONFIGURACIÓN DE BASE DE DATOS
/* const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',      
    password: '$0p0rt3R0y',      
    database: 'sistema_maquinas' 
});

db.connect((err) => {
    if (err) console.error('Error BD:', err);
    else console.log('Conectado exitosamente a MySQL en Localhost');
}); */

// CONFIGURACIÓN DE BASE DE DATOS (CON POOL DE CONEXIONES)
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '$0p0rt3R0y',
    //password: '',
    database: 'sistema_maquinas',
    waitForConnections: true,
    connectionLimit: 10, // Mantiene hasta 10 conexiones abiertas listas para usar
    queueLimit: 0
});

// Prueba opcional para verificar que conecta al iniciar
db.getConnection((err, connection) => {
    if (err) {
        console.error('Error conectando a la BD:', err.code);
    } else {
        console.log('Conectado exitosamente a MySQL (Pool activo)');
        connection.release(); // Siempre liberar la conexión de prueba
    }
});


// --- FUNCIONES DE AYUDA (Helpers) ---

function procesarDatosMaquina(data, tipoNombre) {
    let limpio = { ...data };

    // Serial N/A
    if (!limpio.serial || limpio.serial.trim() === "" || limpio.serial.toUpperCase() === "N/A") {
        limpio.serial = "N/A";
    }

    // Validación estricta de puestos según el nombre del tipo
    const tNombre = tipoNombre ? tipoNombre.toUpperCase() : "";

    if (tNombre === "NORMAL") {
        limpio.puestos = 1;
    } else if (tNombre === "MULTIPUESTO") {
        limpio.puestos = parseInt(limpio.puestos) || 2;
        if (limpio.puestos < 2) limpio.puestos = 2;
    } else {
        limpio.puestos = parseInt(limpio.puestos) || 1;
        if (limpio.puestos < 1) limpio.puestos = 1;
    }

    return limpio;
}

// --- RUTAS API ---

app.get('/api/sucursales_usuario', (req, res) => {
    const { userId } = req.query;

    // Validamos que de verdad venga el ID del usuario
    if (!userId || userId === 'undefined') {
        return res.status(400).json({ error: 'Falta el userId para buscar sus sucursales' });
    }

    // Armamos la consulta cruzando la sucursal con la tabla pivote
    const sql = `
        SELECT s.*, g.nombre as grupo_nom 
        FROM sucursal s 
        LEFT JOIN grupo g ON s.grupo_id = g.id
        INNER JOIN usuario_sucursal us ON s.id = us.sucursal_id 
        WHERE us.usuario_id = ${mysql.escape(userId)}
        ORDER BY s.nombre
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error SQL Sucursales por Usuario:", err.message);
            return res.status(500).send(err.message);
        }
        res.json(results);
    });
});

app.post('/api/crear_estadistica', async (req, res) => {
    try {
        const { sucursal_id, fecha } = req.body;

        if (!sucursal_id || !fecha) {
            return res.status(400).json({ error: "La sucursal y la fecha son obligatorias." });
        }

        // 1. Insertar la cabecera en 'estadistica_diaria'
        const [resultEstadistica] = await db.promise().query(
            'INSERT INTO estadistica_diaria (id_sucursal, fecha) VALUES (?, ?)',
            [sucursal_id, fecha]
        );

        const estadisticaId = resultEstadistica.insertId;

        // 2. Consultar las máquinas trayendo también el ID de la marca desde el modelo
        const [maquinas] = await db.promise().query(`
            SELECT 
                m.*,
                t.nombre AS tipo_nombre,
                mo.nombre AS modelo_nombre,
                mo.marca_id AS marca_id,      -- <- Traemos el ID de la marca desde la tabla modelo
                mar.nombre AS marca_nombre,    -- <- Traemos el nombre de la marca
                v.nombre AS valor_nombre,
                e.nombre AS estado_nombre,
                s.nombre AS sociedad_nombre,
                j.nombre AS juego_nombre,
                mod_p.nombre AS modo_nombre,
                suc.nombre AS sucursal_nombre
            FROM maquina m
            LEFT JOIN tipo t ON m.tipo_id = t.id
            LEFT JOIN modelo mo ON m.modelo_id = mo.id
            LEFT JOIN marca mar ON mo.marca_id = mar.id 
            LEFT JOIN valor v ON m.valor_id = v.id
            LEFT JOIN estado e ON m.estado_id = e.id
            LEFT JOIN sociedad s ON m.sociedad_id = s.id
            LEFT JOIN juego j ON m.juego_id = j.id
            LEFT JOIN modo mod_p ON m.modo_id = mod_p.id
            LEFT JOIN sucursal suc ON m.sucursal_id = suc.id
            WHERE m.sucursal_id = ?
        `, [sucursal_id]);

        // 3. Insertar cada máquina con el snapshot JSON con todas sus propiedades normalizadas como objetos
        if (maquinas && maquinas.length > 0) {
            for (const maq of maquinas) {
                const infoCompleta = {
                    id: maq.id,
                    nombre: maq.nombre,
                    serial: maq.serial,
                    puestos: maq.puestos,
                    marca: { id: maq.marca_id, nombre: maq.marca_nombre || "N/A" }, // <- Ahora como objeto { id, nombre }
                    modelo: { id: maq.modelo_id, nombre: maq.modelo_nombre },
                    tipo: { id: maq.tipo_id, nombre: maq.tipo_nombre },
                    valor: { id: maq.valor_id, nombre: maq.valor_nombre },
                    estado: { id: maq.estado_id, nombre: maq.estado_nombre },
                    sociedad: { id: maq.sociedad_id, nombre: maq.sociedad_nombre },
                    juego: { id: maq.juego_id, nombre: maq.juego_nombre },
                    modo: { id: maq.modo_id, nombre: maq.modo_nombre },
                    sucursal: { id: maq.sucursal_id, nombre: maq.sucursal_nombre }
                };

                await db.promise().query(
                    `INSERT INTO estadistica_maquina 
                    (id_estadistica, info_maquina, contador_entrada, contador_salida) 
                    VALUES (?, ?, 0, 0)`,
                    [estadisticaId, JSON.stringify(infoCompleta)]
                );
            }
        }

        return res.json({
            success: true,
            message: "Estadística creada con éxito y marca formateada como objeto",
            estadisticaId
        });

    } catch (error) {
        console.error("Error al crear estadística:", error);
        return res.status(500).json({ error: error.message });
    }
});

// GET: Listar las estadísticas maestras
/* app.get('/api/estadistica', (req, res) => {
    const sql = `
        SELECT e.id, e.fecha, s.nombre as sucursal 
        FROM estadistica_diaria e
        LEFT JOIN sucursal s ON e.id_sucursal = s.id
        ORDER BY e.fecha DESC
    `;
    db.query(sql, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Error obteniendo las estadísticas' });
        }
        res.json(rows);
    });
}); */

app.get('/api/estadistica', (req, res) => {
    // 1. Extraemos el userId igual que en tu otro endpoint
    const { userId } = req.query;

    // 2. Armamos la base de la consulta
    let sql = `
        SELECT e.id, e.fecha, s.nombre as sucursal 
        FROM estadistica_diaria e
        LEFT JOIN sucursal s ON e.id_sucursal = s.id
    `;

    // 3. Aplicamos TU misma validación para filtrar por la tabla pivote
    if (userId && userId !== 'undefined') {
        sql += ` INNER JOIN usuario_sucursal us ON e.id_sucursal = us.sucursal_id WHERE us.usuario_id = ${mysql.escape(userId)}`;
    }

    // 4. Le pegamos el ORDER BY al final
    sql += ` ORDER BY e.fecha DESC`;

    // 5. Ejecutamos
    db.query(sql, (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Error obteniendo las estadísticas' });
        }
        res.json(rows);
    });
});

// GET: Obtener el detalle con JOIN para ver el nombre de la máquina
app.get('/api/detalle_estadistica/:id_estadistica', (req, res) => {
    const { id_estadistica } = req.params;
    const sql = `
        SELECT em.id, em.contador_entrada, em.contador_salida, m.nombre as nombre_maquina 
        FROM estadistica_maquina em
        JOIN maquina m ON em.id_maquina = m.id
        WHERE em.id_estadistica = ?
    `;
    db.query(sql, [id_estadistica], (err, detalle) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Error obteniendo detalle' });
        }
        res.json(detalle);
    });
});

app.delete('/api/estadistica/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Borrar los registros hijos en 'estadistica_maquina' usando el wrapper de promesas
        await db.promise().query(
            'DELETE FROM estadistica_maquina WHERE id_estadistica = ?',
            [id]
        );

        // 2. Borrar la cabecera en 'estadistica_diaria' usando el wrapper de promesas
        const [result] = await db.promise().query(
            'DELETE FROM estadistica_diaria WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Estadística no encontrada" });
        }

        return res.json({
            success: true,
            message: "Estadística eliminada con éxito"
        });

    } catch (error) {
        console.error("Error al eliminar la estadística:", error);
        return res.status(500).json({ error: error.message });
    }
});


app.get('/api/estadistica/:id/detalles', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Consultar la cabecera (Fecha y Sucursal)
        const [cabecera] = await db.promise().query(
            `SELECT ed.fecha, s.nombre AS sucursal_nombre 
             FROM estadistica_diaria ed
             LEFT JOIN sucursal s ON ed.id_sucursal = s.id
             WHERE ed.id = ?`,
            [id]
        );

        // 2. Consultar las máquinas de la estadística
        const [detalles] = await db.promise().query(
            `SELECT id, id_estadistica, info_maquina, contador_entrada, contador_salida 
             FROM estadistica_maquina 
             WHERE id_estadistica = ?`,
            [id]
        );

        return res.json({
            success: true,
            estadistica: cabecera[0] || { fecha: '', sucursal_nombre: '' },
            detalles
        });
    } catch (error) {
        console.error("Error al obtener detalles de estadística:", error);
        return res.status(500).json({ error: error.message });
    }
});

// Endpoint para actualizar los contadores de una máquina específica en la estadística
app.put('/api/estadistica_maquina/:id/contadores', async (req, res) => {
    try {
        const { id } = req.params;
        const { contador_entrada, contador_salida } = req.body;

        await db.promise().query(
            `UPDATE estadistica_maquina 
             SET contador_entrada = ?, contador_salida = ? 
             WHERE id = ?`,
            [contador_entrada, contador_salida, id]
        );

        return res.json({ success: true, message: "Contadores actualizados correctamente" });
    } catch (error) {
        console.error("Error al actualizar contadores:", error);
        return res.status(500).json({ error: error.message });
    }
});



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

// --- CORRECCIÓN CRÍTICA AQUÍ ---
app.get('/api/options/:tabla', (req, res) => {
    const { tabla } = req.params;

    if (tabla === 'sucursal') {
        // Traemos SIEMPRE todas las sucursales para que el admin pueda elegir
        // Independientemente de si el usuario tiene permisos o no
        const sql = `SELECT s.id, s.nombre, g.nombre as parent_nom 
                     FROM sucursal s 
                     LEFT JOIN grupo g ON s.grupo_id = g.id 
                     ORDER BY g.nombre, s.nombre`;
        db.query(sql, (err, results) => {
            if (err) return res.status(500).send(err);
            res.json(results);
        });
    } else if (tabla === 'modelo') {
        const sql = `SELECT m.id, m.nombre, ma.nombre as parent_nom FROM modelo m LEFT JOIN marca ma ON m.marca_id = ma.id ORDER BY ma.nombre, m.nombre`;
        db.query(sql, (err, results) => {
            if (err) return res.status(500).send(err);
            res.json(results);
        });
    } else {
        const sql = `SELECT * FROM ${tabla} ORDER BY nombre`;
        db.query(sql, (err, results) => {
            if (err) return res.status(500).send(err);
            res.json(results);
        });
    }
});

app.get('/api/references/all', async (req, res) => {
    const tablas = [
        'grupo', 'sucursal', 'marca', 'modelo',
        'juego', 'estado', 'sociedad', 'valor',
        'tipo', 'modo', 'legal'
    ];
    try {
        const promesas = tablas.map(tabla => {
            return new Promise((resolve, reject) => {
                db.query(`SELECT * FROM ${tabla}`, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve({ [tabla]: rows });
                });
            });
        });
        const resultados = await Promise.all(promesas);
        const respuestaUnificada = resultados.reduce((acc, curr) => ({ ...acc, ...curr }), {});
        res.json(respuestaUnificada);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/:tabla', (req, res) => {
    const { tabla } = req.params;
    const { userId } = req.query;

    // --- BLOQUE PIANAS ---
    if (tabla === 'pianas') {
        // Añadimos s.pianas_xl a la consulta
        const sql = "SELECT s.id, s.nombre, s.grupo_id, s.pianas, s.pianas_xl, g.nombre as grupo_nom FROM sucursal s LEFT JOIN grupo g ON s.grupo_id = g.id ORDER BY s.nombre";
        //const sql = "SELECT s.id, s.nombre, s.grupo_id, s.pianas, g.nombre as grupo_nom FROM sucursal s LEFT JOIN grupo g ON s.grupo_id = g.id ORDER BY s.nombre";

        // CORRECCIÓN: Quitamos el 'return' de aquí abajo. 
        // Solo ejecutamos db.query y dejamos que el callback responda.
        db.query(sql, (err, results) => {
            if (err) {
                console.error("Error SQL Pianas:", err.message);
                return res.status(500).send(err.message);
            }
            res.json(results);
        });
        return; // Este return SÍ va aquí para detener la ejecución y que no siga al código de abajo
    }
    // ---------------------

    let sql = "";
    if (tabla === 'maquina') {
        sql = `SELECT m.*, 
            g.nombre as grupo_nom, s.nombre as sala_nom, 
            ma.nombre as marca_nom, mo.nombre as modelo_nom, 
            j.nombre as juego_nom, e.nombre as estado_nom, 
            so.nombre as sociedad_nom, v.nombre as valor_nom,
            t.nombre as tipo_nom, md.nombre as modo_nom,
            l.nombre as legal_nom 
            FROM maquina m 
            LEFT JOIN sucursal s ON m.sucursal_id = s.id 
            LEFT JOIN grupo g ON s.grupo_id = g.id 
            LEFT JOIN modelo mo ON m.modelo_id = mo.id 
            LEFT JOIN marca ma ON mo.marca_id = ma.id 
            LEFT JOIN juego j ON m.juego_id = j.id 
            LEFT JOIN estado e ON m.estado_id = e.id 
            LEFT JOIN sociedad so ON m.sociedad_id = so.id 
            LEFT JOIN valor v ON m.valor_id = v.id
            LEFT JOIN tipo t ON m.tipo_id = t.id
            LEFT JOIN modo md ON m.modo_id = md.id
            LEFT JOIN legal l ON m.legal_id = l.id`;
        if (userId && userId !== 'undefined') {
            sql += ` INNER JOIN usuario_sucursal us ON m.sucursal_id = us.sucursal_id WHERE us.usuario_id = ${mysql.escape(userId)}`;
        }
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
    // CAMBIO 1: Usamos 'let' para poder modificar la variable
    let { tabla, id } = req.params;

    // CAMBIO 2: Si piden 'pianas', buscamos en 'sucursal'
    if (tabla === 'pianas') {
        tabla = 'sucursal';
    }

    // Ahora sí hacemos la consulta a la tabla correcta
    db.query(`SELECT * FROM ${tabla} WHERE id = ?`, [id], (err, results) => {
        if (err) return res.status(500).send(err.message);
        res.json(results[0]);
    });
});

app.post('/api/:tabla', (req, res) => {
    const { tabla } = req.params;
    let data = req.body;

    if (tabla === 'maquina') {
        data = procesarDatosMaquina(data); // Aplicamos la limpieza
    }

    db.query(`INSERT INTO ${tabla} SET ?`, data, (err, result) => {
        if (err) return res.status(500).send(err.message);
        res.json({ id: result.insertId, ...data });
    });
});

app.put('/api/:tabla/:id', (req, res) => {
    let { tabla, id } = req.params;
    let data = req.body;

    // --- Redirección de Pianas a Sucursal ---
    if (tabla === 'pianas') {
        tabla = 'sucursal'; // Ahora sí funciona porque usamos 'let' arriba
    }
    // -------------------

    if (tabla === 'maquina') {
        data = procesarDatosMaquina(data); // Aplicamos la limpieza también al editar
    }

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