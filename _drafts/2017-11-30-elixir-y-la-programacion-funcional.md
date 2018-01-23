---
layout: post
title: Elixir y la programación funcional.
excerpt: "Introducción a la programacion funcional con elixir"
categories: [programación]
comments: true
image:
  feature: https://farm4.staticflickr.com/3947/33884931711_08cb52a9ae_k.jpg
  credit: kecko
  creditlink: https://www.flickr.com/photos/kecko/
---

Elixir es un superset de Erlang. Erlang fue creado para diseñar y desplegar sistemas concurrentes, dicho modelo concurrente fue diseñado para utilizar multiples procesadores en red, y para crear aplicaciones distribuidas de tiempo real. Erlang y Elixir hace uso del paradigma funcional, en el cual las funciones son piezas fundamentales encargadas de transformar los datos de entrada. Dentro de las funciones, los datos son inmutables, por lo que constantemente se crean versiones nuevas de los datos reduciendo de esta forma la necesidad de implementar mecanismos de sincronización de datos.

El paradigma funcional busca crear funciones independientes, que se puedan convinar para obtener nuevos resultados o transformaciones. Ilustremos este forma de modelar sistemas con un ejemplo.

En el paradigma orientado a objetos:

card = 88
def bingo(card)
  if(card == 88) then
   return "bingo"
  else
   return "no win"
  end     
end


En el paradigma funcional:

card = 88
bingo = fn
  (88)->"bingo"
  (_) ->"no win"
end

  
