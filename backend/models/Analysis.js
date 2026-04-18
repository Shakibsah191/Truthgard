const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const User = require('./User');

const Analysis = sequelize.define('Analysis', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  inputType: {
    type: DataTypes.ENUM('url', 'text'),
    allowNull: false
  },
  inputContent: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  totalScore: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  verdict: {
    type: DataTypes.ENUM('REAL', 'SUSPICIOUS', 'FAKE'),
    allowNull: false
  },
  textScore: DataTypes.FLOAT,
  templateScore: DataTypes.FLOAT,
  domainScore: DataTypes.FLOAT,
  headlineScore: DataTypes.FLOAT,
  details: DataTypes.JSON
}, {
  timestamps: true
});

User.hasMany(Analysis, { foreignKey: 'userId' });
Analysis.belongsTo(User, { foreignKey: 'userId' });

module.exports = Analysis;
