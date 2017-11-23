---
layout: post
title: Bajo acoplamiento en la construcción de software. Parte I.
excerpt: "La ortogonalidad  o bajo acoplamiento es un concepto crítico para producir software fácil de diseñar, construir, probar y mantener"
categories: [ingeniería de software]
comments: true
image:
  feature: https://farm4.staticflickr.com/3947/33884931711_08cb52a9ae_k.jpg
  credit: kecko
  creditlink: https://www.flickr.com/photos/kecko/
---


El concepto de bajo acoplamiento en software (y en la computación en general) tiene el propósito de eliminar efectos entre componentes, objetos o funciones que no están relacionados entre sí. Es deseable que los componentes de un software estén aislados para incrementar la productividad y reducir los riesgos.

**Productividad:** Los cambios en el software pueden realizarse de forma focalizada por programadores o equipos diferentes. Definir componentes aislados, con responsabilidades definidas, también facilita la construcción de tests unitarios. Finalmente, cuando existen componentes bien definidos se promueve el reúso a lo largo de todo el sistema.

**Reducir el Riesgo:** Los errores están aislados, ya que pertenecen a un componente específico se puede modificar o cambiar completamente. Al facilitar las pruebas unitarias, es probable que también se reduzca el riesgo de introducir bugs.

### Como reducir el acoplamiento?

Existen varias técnicas, en este primer post se describe la denominada *Ley de Demeter*

> "Law of Demeter", The Pragmatic Programmer. Hunt & Thomas. Cap 5: Bend or Break.

Esta ley busca eliminar el acoplamiento entre módulos previniendo que objetos o clases tengan acceso a métodos o funciones más allá de sus dependencias directas. En este sentido un método de un objeto debe llamar solo metodos que cumplan estas condiciones:

* Pertenecen a su misma clase (u objeto).
* Pertenecen a un objeto pasado como referencia.
* Son de un objeto creado internamente.
* Pertenecen a objetos que son componentes directos.



## Ejemplo práctico

Supongamos tres clases de un diseño orientado a objetos de un sistema para simular el funcionamiento de un vehículo, llamadas: **Driver**, **Car** y **Engine**. Vamos a ver primero como podría ser un sistema que no cumple la ley de Demeter y posteriormente una que sí lo hace:

<i class="fa fa-exclamation" ></i>  **Anti-ejemplo** de la *Ley de Demeter*.
{: .notice}


{% highlight java %}
public class Driver{
  private Car automovil;
  public void iniciarConduccion(Garage g){
    automovil = g.getCar(); // no crea el componente
    automovil.engine.start(); //engine no es un componente directo ni es pasado como parámetro
  }
}
{% endhighlight %}


<i class="fa fa-thumbs-o-up" aria-hidden="true"></i>  Una implementación adecuada, usando la ley de Demeter sería la siguiente:
{: .notice}

{% highlight java %}
public class Driver{
  private Car automovil;
  public void iniciarConduccion(Garage g){
    automovil = new Car(); //usa constructores.
    g.abrirGarage(); //utiliza metodos de objetos entregados como parámetros .
    automovil.start();// metodo que pertenece a un componente directo.
    iniciarConduccion(); //llama un metodo propio.
  }
}
{% endhighlight %}

En general, un objeto contratista puede (y debería) "subcontratar" otros objetos para prestar un servicio a un objeto cliente. Sin embargo el objeto cliente solo tiene que lidiar con el contratista y no necesita los detalles más allá de los resultados.
